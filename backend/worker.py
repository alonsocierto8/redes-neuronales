import json
import logging
import os
import socket
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from sqlalchemy import func, select, update

from app import models
from app.database import Base, DATA_DIR, SessionLocal, engine

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("neurolab.worker")
WORKER_ID = os.getenv("WORKER_ID", f"{socket.gethostname()}-{os.getpid()}")
Base.metadata.create_all(bind=engine)
UPLOAD_DIR = DATA_DIR / "uploads"
MODEL_DIR = DATA_DIR / "models"
WORK_DIR = DATA_DIR / "work"
MODEL_DIR.mkdir(parents=True, exist_ok=True)
WORK_DIR.mkdir(parents=True, exist_ok=True)


def _claim_job() -> int | None:
    with SessionLocal.begin() as db:
        setting = db.get(models.SystemSetting, "max_active_jobs")
        max_active = int(setting.value) if setting else 1
        active = db.scalar(
            select(func.count())
            .select_from(models.TrainingJob)
            .where(models.TrainingJob.status.in_(["PREPARING", "RUNNING"]))
        )
        if active >= max_active:
            return None
        job_id = db.scalar(
            select(models.TrainingJob.id)
            .where(models.TrainingJob.status == "QUEUED", models.TrainingJob.cancel_requested.is_(False))
            .order_by(models.TrainingJob.created_at)
            .limit(1)
        )
        if job_id is None:
            return None
        claimed = db.execute(
            update(models.TrainingJob)
            .where(models.TrainingJob.id == job_id, models.TrainingJob.status == "QUEUED")
            .values(
                status="PREPARING",
                started_at=datetime.now(timezone.utc),
            )
        )
        return job_id if claimed.rowcount == 1 else None


def _record_heartbeat() -> None:
    with SessionLocal.begin() as db:
        heartbeat = db.get(models.WorkerHeartbeat, WORKER_ID)
        if heartbeat is None:
            db.add(models.WorkerHeartbeat(worker_id=WORKER_ID, last_seen=datetime.now(timezone.utc)))
        else:
            heartbeat.last_seen = datetime.now(timezone.utc)


def _train(job_id: int) -> None:
    try:
        import tensorflow as tf
    except ImportError as exc:
        with SessionLocal.begin() as db:
            job = db.get(models.TrainingJob, job_id)
            if job:
                job.status = "FAILED"
                job.error_message = (
                    "TensorFlow no está instalado en el entorno del worker. "
                    "Instala backend/requirements-ml.txt en Linux/WSL para ejecutar CNN."
                )
                job.ended_at = datetime.now(timezone.utc)
        logger.exception("TensorFlow is unavailable; job %s failed", job_id)
        return

    with SessionLocal() as db:
        job = db.get(models.TrainingJob, job_id)
        if job is None:
            return
        architecture = db.get(models.Architecture, job.architecture_id)
        dataset = db.get(models.Dataset, job.dataset_id)
        if architecture is None or dataset is None:
            raise ValueError("No se encontró la arquitectura o el dataset.")
        config = json.loads(architecture.config_json)
        archive_path = UPLOAD_DIR / f"{dataset.storage_key}.zip"
        project_id = job.project_id
        epochs = job.epochs
        batch_size = job.batch_size
        optimizer_name = job.optimizer

    extract_dir = WORK_DIR / f"job-{job_id}"
    extract_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path) as archive:
        root_dirs = {
            PurePosixPath(item.filename.replace("\\", "/")).parts[0]
            for item in archive.infolist()
            if PurePosixPath(item.filename.replace("\\", "/")).parts
        }
        for item in archive.infolist():
            path = PurePosixPath(item.filename.replace("\\", "/"))
            if path.is_absolute() or ".." in path.parts:
                raise ValueError("El dataset contiene una ruta no permitida.")
        archive.extractall(extract_dir)
    dataset_root = extract_dir / next(iter(root_dirs)) if len(root_dirs) == 1 else extract_dir
    config_ds = tf.keras.utils.image_dataset_from_directory(
        dataset_root,
        image_size=(config["input_height"], config["input_width"]),
        batch_size=batch_size,
        label_mode="int",
        validation_split=0.2,
        subset="both",
        seed=42,
        color_mode={1: "grayscale", 3: "rgb", 4: "rgba"}[config["input_channels"]],
    )
    train_ds, validation_ds = config_ds
    class_count = len(train_ds.class_names)
    layer_specs = config["layers"]
    output = next(layer for layer in reversed(layer_specs) if layer["type"] == "Dense")
    if output["units"] != class_count:
        raise ValueError("La salida de la CNN no coincide con las clases del dataset.")
    inputs = tf.keras.Input(shape=(config["input_height"], config["input_width"], config["input_channels"]))
    value = inputs
    for spec in layer_specs:
        layer_type = spec["type"]
        if layer_type == "Conv2D":
            value = tf.keras.layers.Conv2D(
                filters=spec["filters"],
                kernel_size=spec["kernel_size"],
                activation=spec["activation"],
                padding="same",
            )(value)
        elif layer_type == "MaxPooling2D":
            value = tf.keras.layers.MaxPooling2D(pool_size=2)(value)
        elif layer_type == "Flatten":
            value = tf.keras.layers.Flatten()(value)
        elif layer_type == "Dense":
            value = tf.keras.layers.Dense(spec["units"], activation=spec["activation"])(value)
        elif layer_type == "Dropout":
            value = tf.keras.layers.Dropout(spec["rate"])(value)
    model = tf.keras.Model(inputs=inputs, outputs=value)
    model.compile(
        optimizer=optimizer_name.lower(),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    with SessionLocal.begin() as db:
        job = db.get(models.TrainingJob, job_id)
        if job is None or job.cancel_requested:
            if job:
                job.status = "CANCELLED"
                job.ended_at = datetime.now(timezone.utc)
            return
        job.status = "RUNNING"
        db.add(
            models.AuditEvent(
                actor_id=job.owner_id,
                project_id=project_id,
                action="training.started",
                metadata_json=json.dumps({"job_id": job_id}),
            )
        )

    class ProgressCallback(tf.keras.callbacks.Callback):
        def on_epoch_end(self, epoch, logs=None):
            logs = logs or {}
            with SessionLocal.begin() as db:
                current = db.get(models.TrainingJob, job_id)
                if current is None:
                    self.model.stop_training = True
                    return
                if current.cancel_requested:
                    current.status = "CANCELLED"
                    current.ended_at = datetime.now(timezone.utc)
                    self.model.stop_training = True
                    return
                current.epoch = epoch + 1
                current.progress = round((epoch + 1) * 100 / epochs)
                current.loss = float(logs.get("loss", 0))
                current.accuracy = float(logs.get("accuracy", 0))
                for metric_name, metric_value in logs.items():
                    db.add(
                        models.TrainingMetric(
                            job_id=job_id,
                            epoch=epoch + 1,
                            metric_name=metric_name,
                            metric_value=float(metric_value),
                        )
                    )

    model.fit(
        train_ds.prefetch(tf.data.AUTOTUNE),
        validation_data=validation_ds.prefetch(tf.data.AUTOTUNE),
        epochs=epochs,
        callbacks=[ProgressCallback()],
        verbose=0,
    )
    with SessionLocal.begin() as db:
        job = db.get(models.TrainingJob, job_id)
        if job is None:
            return
        if job.cancel_requested or job.status == "CANCELLED":
            job.status = "CANCELLED"
        else:
            model.save(MODEL_DIR / f"job-{job_id}.keras")
            job.status = "COMPLETED"
            job.progress = 100
        job.ended_at = datetime.now(timezone.utc)
        db.add(
            models.AuditEvent(
                actor_id=job.owner_id,
                project_id=project_id,
                action=f"training.{job.status.lower()}",
                metadata_json=json.dumps({"job_id": job_id}),
            )
        )
    logger.info("Training job %s finished", job_id)
    import shutil

    shutil.rmtree(extract_dir, ignore_errors=True)


def run_worker(poll_seconds: float = 2):
    logger.info("NeuroLab CNN worker started")
    last_heartbeat = 0.0
    while True:
        if time.monotonic() - last_heartbeat >= 5:
            _record_heartbeat()
            last_heartbeat = time.monotonic()
        job_id = _claim_job()
        if job_id is None:
            time.sleep(poll_seconds)
            continue
        try:
            _train(job_id)
        except Exception as exc:
            logger.exception("Training job %s failed", job_id)
            with SessionLocal.begin() as db:
                job = db.get(models.TrainingJob, job_id)
                if job and job.status not in {"CANCELLED", "COMPLETED"}:
                    job.status = "FAILED"
                    job.error_message = str(exc)[:1000]
                    job.ended_at = datetime.now(timezone.utc)


if __name__ == "__main__":
    run_worker()
