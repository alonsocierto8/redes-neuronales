import hashlib
import hmac
import json
import csv
import math
import os
import secrets
import time
import zipfile
from datetime import datetime, timezone
from io import BytesIO, StringIO
from pathlib import PurePosixPath

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import models
from .database import Base, DATA_DIR, SessionLocal, engine, get_db
from .schemas import (
    ArchitectureCreate,
    ArchitectureResponse,
    AuthResponse,
    DatasetResponse,
    LoginRequest,
    ProjectMemberCreate,
    ProjectCreate,
    ProjectResponse,
    RegisterRequest,
    SettingsUpdate,
    TrainingCreate,
    UserResponse,
    decode_json,
    safe_filename,
)

Base.metadata.create_all(bind=engine)
app = FastAPI(title="NeuroLab Enterprise API", version="1.0.0", openapi_url="/api/v1/openapi.json")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

SECRET_KEY = os.getenv("NEUROLAB_SECRET_KEY") or secrets.token_hex(32)
TOKEN_TTL_SECONDS = 60 * 60 * 8
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp"}
ROLES = {"Administrador", "Responsable de proyecto", "Ingeniero de IA", "Revisor", "Lector"}
UPLOAD_DIR = DATA_DIR / "uploads"
MODEL_DIR = DATA_DIR / "models"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MODEL_DIR.mkdir(parents=True, exist_ok=True)


def _b64(value: bytes) -> str:
    import base64

    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return f"{_b64(salt)}${_b64(derived)}"


def _verify_password(password: str, encoded: str) -> bool:
    try:
        salt_text, expected = encoded.split("$", 1)
        actual = _password_hash(password, _decode_b64(salt_text)).split("$", 1)[1]
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def _decode_b64(value: str) -> bytes:
    import base64

    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _issue_token(user: models.User) -> str:
    payload = _b64(
        json.dumps(
            {"sub": user.id, "exp": int(time.time()) + TOKEN_TTL_SECONDS},
            separators=(",", ":"),
        ).encode()
    )
    signature = _b64(hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{signature}"


from fastapi import Header


def get_current_user(authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Se requiere iniciar sesión.")
    token = authorization.removeprefix("Bearer ")
    try:
        payload_text, signature = token.split(".", 1)
        expected = _b64(hmac.new(SECRET_KEY.encode(), payload_text.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            raise ValueError("invalid signature")
        payload = json.loads(_decode_b64(payload_text))
        if payload["exp"] < time.time():
            raise ValueError("expired")
        user = db.get(models.User, int(payload["sub"]))
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=401, detail="La sesión no es válida o expiró.") from None
    if user is None or user.status != "Activo":
        raise HTTPException(status_code=401, detail="La cuenta no está disponible.")
    return user


def require_roles(*roles: str):
    def dependency(user: models.User = Depends(get_current_user)):
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="No tienes permiso para realizar esta acción.")
        return user

    return dependency


def _audit(
    db: Session,
    user: models.User | None,
    action: str,
    project_id: int | None = None,
    metadata: dict | None = None,
) -> None:
    db.add(
        models.AuditEvent(
            actor_id=user.id if user else None,
            project_id=project_id,
            action=action,
            metadata_json=json.dumps(metadata or {}),
        )
    )


def _project_access(db: Session, user: models.User, project_id: int, write: bool = False):
    project = db.get(models.Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="No se encontró el proyecto.")
    membership = db.scalar(
        select(models.ProjectMember).where(
            models.ProjectMember.project_id == project_id,
            models.ProjectMember.user_id == user.id,
        )
    )
    if membership is None:
        raise HTTPException(status_code=404, detail="No se encontró el proyecto.")
    if write and membership.role == "Lector":
        raise HTTPException(status_code=403, detail="El acceso de lector no permite modificar el proyecto.")
    return project


def _project_response(project: models.Project) -> ProjectResponse:
    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        status=project.status,
        owner=project.owner.display_name,
    )


def _architecture_response(architecture: models.Architecture) -> ArchitectureResponse:
    config = decode_json(architecture.config_json)
    config["family"] = architecture.family
    return ArchitectureResponse(
        id=architecture.id,
        project_id=architecture.project_id,
        name=architecture.name,
        family=architecture.family,
        version=architecture.version,
        config=config,
    )


def _job_response(db: Session, job: models.TrainingJob) -> dict:
    project = db.get(models.Project, job.project_id)
    dataset = db.get(models.Dataset, job.dataset_id)
    architecture = db.get(models.Architecture, job.architecture_id)
    labels = {
        "QUEUED": "En cola",
        "PREPARING": "Preparando",
        "RUNNING": "Ejecutando",
        "COMPLETED": "Completado",
        "FAILED": "Fallido",
        "CANCELLED": "Cancelado",
    }
    return {
        "id": str(job.id),
        "project": project.name,
        "family": architecture.family,
        "status": labels.get(job.status, job.status),
        "progress": job.progress,
        "epoch": job.epoch,
        "epochs": job.epochs,
        "loss": job.loss or 0,
        "accuracy": job.accuracy or 0,
        "duration": "—",
        "date": job.created_at.isoformat(),
        "dataset": dataset.name,
        "error": job.error_message,
    }


@app.get("/api/v1/health")
def health():
    return {"status": "ok", "service": "neurolab-api"}


@app.post("/api/v1/auth/register", response_model=AuthResponse, status_code=201)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    email = str(body.email).lower()
    if db.scalar(select(models.User.id).where(models.User.email == email)):
        raise HTTPException(status_code=409, detail="Ya existe una cuenta con ese correo.")
    role = "Administrador" if db.scalar(select(models.User.id).limit(1)) is None else "Ingeniero de IA"
    user = models.User(
        email=email,
        display_name=body.display_name.strip(),
        password_hash=_password_hash(body.password),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    _audit(db, user, "auth.register")
    db.commit()
    return AuthResponse(access_token=_issue_token(user), user=UserResponse.model_validate(user))


@app.post("/api/v1/auth/login", response_model=AuthResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(models.User).where(models.User.email == str(body.email).lower()))
    if user is None or user.status != "Activo" or not _verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Correo o contraseña incorrectos.")
    _audit(db, user, "auth.login")
    db.commit()
    return AuthResponse(access_token=_issue_token(user), user=UserResponse.model_validate(user))


@app.get("/api/v1/auth/me", response_model=UserResponse)
def me(user: models.User = Depends(get_current_user)):
    return user


@app.get("/api/v1/projects", response_model=list[ProjectResponse])
def list_projects(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    projects = db.scalars(
        select(models.Project)
        .join(models.ProjectMember, models.ProjectMember.project_id == models.Project.id)
        .where(models.ProjectMember.user_id == user.id)
        .order_by(models.Project.created_at.desc())
    ).all()
    return [_project_response(project) for project in projects]


@app.post("/api/v1/projects", response_model=ProjectResponse, status_code=201)
def create_project(
    body: ProjectCreate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = models.Project(name=body.name.strip(), description=body.description.strip(), owner_id=user.id)
    db.add(project)
    db.flush()
    db.add(models.ProjectMember(project_id=project.id, user_id=user.id, role=user.role))
    _audit(db, user, "project.created", project.id, {"family": "CNN"})
    db.commit()
    db.refresh(project)
    return _project_response(project)


@app.get("/api/v1/projects/{project_id}/members")
def list_project_members(
    project_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _project_access(db, user, project_id)
    members = db.scalars(
        select(models.ProjectMember).where(models.ProjectMember.project_id == project_id)
    ).all()
    return [
        {
            "id": member.id,
            "user_id": member.user_id,
            "display_name": db.get(models.User, member.user_id).display_name,
            "email": db.get(models.User, member.user_id).email,
            "role": member.role,
            "is_owner": member.user_id == db.get(models.Project, project_id).owner_id,
        }
        for member in members
    ]


@app.post("/api/v1/projects/{project_id}/members", status_code=201)
def add_project_member(
    project_id: int,
    body: ProjectMemberCreate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _project_access(db, user, project_id, write=True)
    membership = db.scalar(
        select(models.ProjectMember).where(
            models.ProjectMember.project_id == project_id,
            models.ProjectMember.user_id == user.id,
        )
    )
    if user.role != "Administrador" and (membership is None or membership.role != "Responsable de proyecto"):
        raise HTTPException(status_code=403, detail="Solo el administrador o responsable del proyecto puede invitar integrantes.")
    invited = db.scalar(select(models.User).where(models.User.email == str(body.email).lower()))
    if invited is None:
        raise HTTPException(status_code=404, detail="La persona debe crear una cuenta antes de ser invitada.")
    existing = db.scalar(
        select(models.ProjectMember).where(
            models.ProjectMember.project_id == project_id,
            models.ProjectMember.user_id == invited.id,
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="La persona ya pertenece al proyecto.")
    db.add(models.ProjectMember(project_id=project_id, user_id=invited.id, role=body.role))
    _audit(db, user, "project.member.added", project_id, {"member_id": invited.id, "role": body.role})
    db.commit()
    return {"id": invited.id, "display_name": invited.display_name, "email": invited.email, "role": body.role}


@app.delete("/api/v1/projects/{project_id}/members/{member_user_id}", status_code=204)
def remove_project_member(
    project_id: int,
    member_user_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _project_access(db, user, project_id, write=True)
    membership = db.scalar(
        select(models.ProjectMember).where(
            models.ProjectMember.project_id == project_id,
            models.ProjectMember.user_id == user.id,
        )
    )
    if user.role != "Administrador" and (membership is None or membership.role != "Responsable de proyecto"):
        raise HTTPException(status_code=403, detail="Solo el administrador o responsable del proyecto puede quitar integrantes.")
    target = db.scalar(
        select(models.ProjectMember).where(
            models.ProjectMember.project_id == project_id,
            models.ProjectMember.user_id == member_user_id,
        )
    )
    if target is None:
        raise HTTPException(status_code=404, detail="No se encontró el integrante.")
    if member_user_id == project.owner_id:
        raise HTTPException(status_code=409, detail="No se puede quitar a la persona propietaria del proyecto.")
    _audit(db, user, "project.member.removed", project_id, {"member_id": member_user_id})
    db.delete(target)
    db.commit()


@app.get("/api/v1/projects/{project_id}")
def get_project(
    project_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _project_response(_project_access(db, user, project_id))


@app.patch("/api/v1/projects/{project_id}")
def update_project(
    project_id: int,
    body: ProjectCreate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _project_access(db, user, project_id, write=True)
    project.name = body.name.strip()
    project.description = body.description.strip()
    _audit(db, user, "project.updated", project.id)
    db.commit()
    return _project_response(project)


@app.get("/api/v1/projects/{project_id}/architectures", response_model=list[ArchitectureResponse])
def list_architectures(
    project_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _project_access(db, user, project_id)
    return [
        _architecture_response(row)
        for row in db.scalars(
            select(models.Architecture)
            .where(models.Architecture.project_id == project_id)
            .order_by(models.Architecture.version.desc())
        )
    ]


@app.post("/api/v1/projects/{project_id}/architectures", response_model=ArchitectureResponse, status_code=201)
def save_architecture(
    project_id: int,
    body: ArchitectureCreate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _project_access(db, user, project_id, write=True)
    config = body.model_dump()
    last_version = db.scalar(
        select(models.Architecture.version)
        .where(models.Architecture.project_id == project_id)
        .order_by(models.Architecture.version.desc())
        .limit(1)
    )
    architecture = models.Architecture(
        project_id=project_id,
        name=body.name.strip(),
        family=body.family,
        config_json=json.dumps(config),
        version=(last_version or 0) + 1,
    )
    db.add(architecture)
    db.flush()
    _audit(db, user, "architecture.created", project_id, {"architecture_id": architecture.id})
    db.commit()
    db.refresh(architecture)
    return _architecture_response(architecture)


def _validate_dataset_archive(data: bytes) -> dict:
    try:
        archive = zipfile.ZipFile(BytesIO(data))
        entries = archive.infolist()
    except (zipfile.BadZipFile, OSError):
        raise HTTPException(status_code=400, detail="El archivo no es un ZIP válido.") from None
    if len(entries) > 20_000 or sum(item.file_size for item in entries) > MAX_UNCOMPRESSED_BYTES:
        raise HTTPException(status_code=413, detail="El dataset excede los límites de extracción.")
    class_names: set[str] = set()
    image_count = 0
    image_paths = []
    root_dirs = set()
    for item in entries:
        path = PurePosixPath(item.filename.replace("\\", "/"))
        if path.is_absolute() or ".." in path.parts or (path.parts and ":" in path.parts[0]):
            raise HTTPException(status_code=400, detail="El ZIP contiene rutas inseguras.")
        if item.file_size and item.compress_size and item.file_size / item.compress_size > 200:
            raise HTTPException(status_code=413, detail="El ZIP contiene un archivo con compresión excesiva.")
        parts = path.parts
        if len(parts) > 1:
            root_dirs.add(parts[0])
        if path.suffix.lower() in IMAGE_EXTENSIONS and len(parts) >= 2:
            image_paths.append(parts)
            image_count += 1
    has_common_root = len(root_dirs) == 1
    for parts in image_paths:
        class_index = 1 if has_common_root else 0
        if len(parts) != class_index + 2:
            raise HTTPException(
                status_code=400,
                detail="Organiza las imágenes así: [raíz opcional]/nombre_de_clase/imagen.jpg.",
            )
        class_names.add(parts[class_index])
    if len(class_names) < 2 or image_count < 2:
        raise HTTPException(
            status_code=400,
            detail="Una CNN de clasificación requiere imágenes en al menos dos carpetas de clase dentro del ZIP.",
        )
    if len(class_names) > 4096:
        raise HTTPException(status_code=400, detail="El dataset CNN no puede tener más de 4096 clases.")
    return {
        "family": "CNN",
        "classes": sorted(class_names),
        "class_count": len(class_names),
        "images": image_count,
    }


def _validate_tabular_csv(data: bytes, target_column: str | None) -> dict:
    try:
        text = data.decode("utf-8-sig")
        rows = list(csv.reader(StringIO(text)))
    except (UnicodeDecodeError, csv.Error):
        raise HTTPException(status_code=400, detail="El archivo debe ser un CSV UTF-8 válido.") from None
    if len(rows) < 4:
        raise HTTPException(status_code=400, detail="El CSV requiere encabezado y al menos tres filas.")
    headers = [header.strip() for header in rows[0]]
    if not headers or any(not header for header in headers) or len(set(headers)) != len(headers):
        raise HTTPException(status_code=400, detail="El CSV requiere nombres de columna únicos y no vacíos.")
    if not target_column or target_column not in headers:
        raise HTTPException(status_code=400, detail="Selecciona una columna objetivo existente en el CSV.")
    feature_names = [header for header in headers if header != target_column]
    if not feature_names or len(feature_names) > 4096:
        raise HTTPException(status_code=400, detail="El CSV debe tener entre 1 y 4096 características.")
    target_index = headers.index(target_column)
    feature_indices = [headers.index(header) for header in feature_names]
    classes: set[str] = set()
    class_counts: dict[str, int] = {}
    row_count = 0
    for row in rows[1:]:
        if len(row) != len(headers):
            raise HTTPException(status_code=400, detail="Todas las filas del CSV deben tener el mismo número de columnas.")
        label = row[target_index].strip()
        if not label:
            raise HTTPException(status_code=400, detail="La columna objetivo no puede contener valores vacíos.")
        for index in feature_indices:
            try:
                value = float(row[index])
            except ValueError:
                raise HTTPException(status_code=400, detail=f"La característica {headers[index]} debe ser numérica.") from None
            if not math.isfinite(value):
                raise HTTPException(status_code=400, detail="El CSV no puede contener valores numéricos infinitos o NaN.")
        row_count += 1
        class_counts[label] = class_counts.get(label, 0) + 1
        if len(class_counts) > 1000:
            raise HTTPException(status_code=400, detail="El conjunto de clases excede el máximo permitido.")
    if len(class_counts) < 2:
        raise HTTPException(status_code=400, detail="La clasificación requiere al menos dos clases.")
    if min(class_counts.values()) < 3:
        raise HTTPException(status_code=400, detail="Cada clase necesita al menos tres filas para separar entrenamiento, validación y prueba.")
    return {
        "family": "Feedforward",
        "target_column": target_column,
        "feature_names": feature_names,
        "classes": sorted(class_counts),
        "class_count": len(class_counts),
        "rows": row_count,
    }


def _dataset_architecture_config(family: str, dataset_id: int, dataset_name: str, metadata: dict) -> dict:
    classes = metadata["classes"]
    if family == "Feedforward":
        feature_count = len(metadata["feature_names"])
        return {
            "family": family,
            "name": f"Auto · {dataset_name}"[:160],
            "input_features": feature_count,
            "generated_for_dataset_id": dataset_id,
            "layers": [
                {"type": "Dense", "units": max(8, min(128, feature_count * 2)), "activation": "relu"},
                {"type": "Dense", "units": len(classes), "activation": "softmax"},
            ],
        }
    return {
        "family": family,
        "name": f"Auto · {dataset_name}"[:160],
        "input_height": 64,
        "input_width": 64,
        "input_channels": 3,
        "generated_for_dataset_id": dataset_id,
        "layers": [
            {"type": "Conv2D", "filters": 32, "kernel_size": 3, "activation": "relu"},
            {"type": "MaxPooling2D"},
            {"type": "Flatten"},
            {"type": "Dense", "units": len(classes), "activation": "softmax"},
        ],
    }


@app.post("/api/v1/projects/{project_id}/datasets", response_model=DatasetResponse, status_code=201)
async def upload_dataset(
    project_id: int,
    name: str = Form(min_length=2, max_length=160),
    family: str = Form(default="CNN"),
    target_column: str | None = Form(default=None),
    file: UploadFile = File(...),
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _project_access(db, user, project_id, write=True)
    filename = safe_filename(file.filename or "dataset.zip")
    if family not in {"CNN", "Feedforward"}:
        raise HTTPException(status_code=422, detail="La familia de dataset no es válida.")
    expected_extension = ".zip" if family == "CNN" else ".csv"
    if not filename.lower().endswith(expected_extension):
        raise HTTPException(
            status_code=400,
            detail=f"Para {family} se requiere un archivo {expected_extension.upper()}.",
        )
    upload_setting = db.get(models.SystemSetting, "max_upload_mb")
    upload_limit = int(upload_setting.value) * 1024 * 1024 if upload_setting else MAX_UPLOAD_BYTES
    content = await file.read(upload_limit + 1)
    if len(content) > upload_limit:
        raise HTTPException(status_code=413, detail=f"El tamaño máximo de carga es {upload_limit // (1024 * 1024)} MB.")
    metadata = _validate_dataset_archive(content) if family == "CNN" else _validate_tabular_csv(content, target_column)
    storage_key = secrets.token_hex(24)
    (UPLOAD_DIR / f"{storage_key}{expected_extension}").write_bytes(content)
    version = (db.scalar(
        select(models.Dataset.version)
        .where(models.Dataset.project_id == project_id, models.Dataset.name == name.strip())
        .order_by(models.Dataset.version.desc())
        .limit(1)
    ) or 0) + 1
    dataset = models.Dataset(
        project_id=project_id,
        name=name.strip()[:160],
        filename=filename,
        storage_key=storage_key,
        metadata_json=json.dumps(metadata),
        version=version,
    )
    db.add(dataset)
    db.flush()
    architecture_config = _dataset_architecture_config(family, dataset.id, dataset.name, metadata)
    last_architecture_version = db.scalar(
        select(models.Architecture.version)
        .where(models.Architecture.project_id == project_id)
        .order_by(models.Architecture.version.desc())
        .limit(1)
    ) or 0
    architecture = models.Architecture(
        project_id=project_id,
        name=architecture_config["name"],
        family=family,
        config_json=json.dumps(architecture_config),
        version=last_architecture_version + 1,
    )
    db.add(architecture)
    db.flush()
    _audit(db, user, "dataset.uploaded", project_id, {"dataset_id": dataset.id})
    _audit(
        db,
        user,
        "architecture.auto_created",
        project_id,
        {"architecture_id": architecture.id, "dataset_id": dataset.id},
    )
    db.commit()
    return DatasetResponse(
        id=dataset.id,
        project_id=project_id,
        name=dataset.name,
        filename=filename,
        version=dataset.version,
        status=dataset.status,
        metadata=metadata,
    )


@app.get("/api/v1/projects/{project_id}/datasets", response_model=list[DatasetResponse])
def list_datasets(
    project_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _project_access(db, user, project_id)
    return [
        DatasetResponse(
            id=row.id,
            project_id=row.project_id,
            name=row.name,
            filename=row.filename,
            version=row.version,
            status=row.status,
            metadata=decode_json(row.metadata_json),
        )
        for row in db.scalars(select(models.Dataset).where(models.Dataset.project_id == project_id))
    ]


@app.delete("/api/v1/datasets/{dataset_id}", status_code=204)
def delete_dataset(
    dataset_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    dataset = db.get(models.Dataset, dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="No se encontró el dataset.")
    _project_access(db, user, dataset.project_id, write=True)
    if db.scalar(select(models.TrainingJob.id).where(models.TrainingJob.dataset_id == dataset_id)):
        raise HTTPException(status_code=409, detail="No se puede eliminar un dataset asociado a entrenamientos.")
    extension = ".csv" if decode_json(dataset.metadata_json).get("family") == "Feedforward" else ".zip"
    (UPLOAD_DIR / f"{dataset.storage_key}{extension}").unlink(missing_ok=True)
    _audit(db, user, "dataset.deleted", dataset.project_id, {"dataset_id": dataset.id})
    db.delete(dataset)
    db.commit()


@app.get("/api/v1/projects/{project_id}/report.pdf")
def project_report_pdf(
    project_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _project_access(db, user, project_id)
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    project = db.get(models.Project, project_id)
    jobs = db.scalars(
        select(models.TrainingJob).where(models.TrainingJob.project_id == project_id).order_by(models.TrainingJob.created_at.desc())
    ).all()
    architectures = db.scalars(
        select(models.Architecture).where(models.Architecture.project_id == project_id).order_by(models.Architecture.version.desc())
    ).all()
    output = BytesIO()
    document = SimpleDocTemplate(output, pagesize=letter, title=f"NeuroLab · {project.name}")
    styles = getSampleStyleSheet()
    content = [
        Paragraph("NeuroLab Enterprise · Informe de proyecto", styles["Title"]),
        Spacer(1, 12),
        Paragraph(f"Proyecto: {project.name}", styles["Heading2"]),
        Paragraph(f"Descripción: {project.description or 'Sin descripción'}", styles["BodyText"]),
        Paragraph(f"Responsable: {project.owner.display_name}", styles["BodyText"]),
        Spacer(1, 16),
    ]
    for heading, rows, widths in [
        (
            "Arquitecturas versionadas",
            [
                ["Nombre", "Familia", "Versión", "Entrada", "Capas"],
                *[
                    [
                        architecture.name,
                        architecture.family,
                        str(architecture.version),
                        f"{decode_json(architecture.config_json).get('input_height')}×{decode_json(architecture.config_json).get('input_width')}×{decode_json(architecture.config_json).get('input_channels')}",
                        str(len(decode_json(architecture.config_json).get("layers", []))),
                    ]
                    for architecture in architectures
                ],
            ],
            [130, 55, 55, 100, 50],
        ),
        (
            "Historial de entrenamientos",
            [
                ["ID", "Estado", "Épocas", "Pérdida", "Exactitud", "Dataset"],
                *[
                    [
                        str(job.id),
                        job.status,
                        f"{job.epoch}/{job.epochs}",
                        f"{job.loss or 0:.4f}",
                        f"{(job.accuracy or 0) * 100:.2f}%",
                        (db.get(models.Dataset, job.dataset_id).name if db.get(models.Dataset, job.dataset_id) else ""),
                    ]
                    for job in jobs
                ],
            ],
            [60, 75, 55, 65, 65, 115],
        ),
    ]:
        content.extend([Paragraph(heading, styles["Heading2"]), Spacer(1, 7)])
        table = Table(rows, repeatRows=1, hAlign="LEFT", colWidths=widths)
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#302c5d")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#c4c9d4")),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]
            )
        )
        content.extend([table, Spacer(1, 14)])
    _audit(db, user, "report.pdf.exported", project_id)
    db.commit()
    document.build(content)
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="neurolab-project-{project_id}.pdf"'},
    )


@app.get("/api/v1/projects/{project_id}/training-jobs")
def list_training_jobs(
    project_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _project_access(db, user, project_id)
    return [
        _job_response(db, job)
        for job in db.scalars(
            select(models.TrainingJob)
            .where(models.TrainingJob.project_id == project_id)
            .order_by(models.TrainingJob.created_at.desc())
        )
    ]


@app.get("/api/v1/training-jobs")
def list_all_training_jobs(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    project_ids = select(models.ProjectMember.project_id).where(models.ProjectMember.user_id == user.id)
    jobs = db.scalars(
        select(models.TrainingJob)
        .where(models.TrainingJob.project_id.in_(project_ids))
        .order_by(models.TrainingJob.created_at.desc())
    )
    return [_job_response(db, job) for job in jobs]


@app.post("/api/v1/projects/{project_id}/training-jobs", status_code=202)
def create_training_job(
    project_id: int,
    body: TrainingCreate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _project_access(db, user, project_id, write=True)
    architecture = db.get(models.Architecture, body.architecture_id)
    dataset = db.get(models.Dataset, body.dataset_id)
    if architecture is None or architecture.project_id != project_id:
        raise HTTPException(status_code=400, detail="Selecciona una arquitectura válida del proyecto.")
    if dataset is None or dataset.project_id != project_id or dataset.status != "Validado":
        raise HTTPException(status_code=400, detail="Selecciona un dataset válido del proyecto.")
    metadata = decode_json(dataset.metadata_json)
    if metadata.get("family", "CNN") != architecture.family:
        raise HTTPException(status_code=400, detail="La arquitectura y el dataset deben pertenecer a la misma familia.")
    config = decode_json(architecture.config_json)
    output_units = next(layer["units"] for layer in reversed(config["layers"]) if layer["type"] == "Dense")
    if output_units != len(metadata.get("classes", [])):
        raise HTTPException(status_code=400, detail="Las unidades de salida deben coincidir con las clases del dataset.")
    if architecture.family == "Feedforward" and config.get("input_features") != len(metadata.get("feature_names", [])):
        raise HTTPException(status_code=400, detail="Las entradas Feedforward deben coincidir con las características del dataset.")
    setting = db.get(models.SystemSetting, "max_active_jobs")
    max_active_jobs = int(setting.value) if setting else 1
    active_jobs = db.scalar(
        select(func.count()).select_from(models.TrainingJob).where(
            models.TrainingJob.status.in_(["QUEUED", "PREPARING", "RUNNING"]),
        )
    )
    if active_jobs >= max_active_jobs:
        raise HTTPException(status_code=429, detail="Se alcanzó el límite de entrenamientos activos.")
    job = models.TrainingJob(
        project_id=project_id,
        architecture_id=architecture.id,
        dataset_id=dataset.id,
        owner_id=user.id,
        epochs=body.epochs,
        batch_size=body.batch_size,
        optimizer=body.optimizer,
    )
    db.add(job)
    db.flush()
    _audit(db, user, "training.queued", project_id, {"job_id": job.id})
    db.commit()
    db.refresh(job)
    return _job_response(db, job)


def _accessible_job(db: Session, user: models.User, job_id: int):
    job = db.get(models.TrainingJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="No se encontró el entrenamiento.")
    _project_access(db, user, job.project_id)
    return job


@app.get("/api/v1/training-jobs/{job_id}")
def get_training_job(
    job_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _job_response(db, _accessible_job(db, user, job_id))


@app.post("/api/v1/training-jobs/{job_id}/cancel")
def cancel_training_job(
    job_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    job = _accessible_job(db, user, job_id)
    membership = db.scalar(
        select(models.ProjectMember).where(
            models.ProjectMember.project_id == job.project_id,
            models.ProjectMember.user_id == user.id,
        )
    )
    if membership.role == "Lector":
        raise HTTPException(status_code=403, detail="No tienes permiso para cancelar entrenamientos.")
    if job.status in {"COMPLETED", "FAILED", "CANCELLED"}:
        raise HTTPException(status_code=409, detail="El entrenamiento ya terminó.")
    job.cancel_requested = True
    if job.status == "QUEUED":
        job.status = "CANCELLED"
        job.ended_at = datetime.now(timezone.utc)
    _audit(db, user, "training.cancel_requested", job.project_id, {"job_id": job.id})
    db.commit()
    return _job_response(db, job)


@app.get("/api/v1/training-jobs/{job_id}/metrics")
def get_training_metrics(
    job_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _accessible_job(db, user, job_id)
    return [
        {"epoch": row.epoch, "name": row.metric_name, "value": row.metric_value, "recorded_at": row.recorded_at.isoformat()}
        for row in db.scalars(
            select(models.TrainingMetric)
            .where(models.TrainingMetric.job_id == job_id)
            .order_by(models.TrainingMetric.epoch, models.TrainingMetric.metric_name)
        )
    ]


@app.get("/api/v1/training-jobs/{job_id}/events")
def training_events(
    job_id: int,
    user: models.User = Depends(get_current_user),
):
    with SessionLocal() as db:
        _accessible_job(db, user, job_id)

    def stream():
        last_payload = None
        while True:
            with SessionLocal() as db:
                job = db.get(models.TrainingJob, job_id)
                if job is None:
                    yield "event: error\ndata: {\"detail\":\"No se encontró el entrenamiento.\"}\n\n"
                    return
                _accessible_job(db, user, job_id)
                payload = json.dumps(_job_response(db, job))
                if payload != last_payload:
                    yield f"event: progress\ndata: {payload}\n\n"
                    last_payload = payload
                if job.status in {"COMPLETED", "FAILED", "CANCELLED"}:
                    return
            time.sleep(1)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.get("/api/v1/projects/{project_id}/models")
def list_models(
    project_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _project_access(db, user, project_id)
    result = []
    for model in db.scalars(
        select(models.ModelVersion)
        .where(models.ModelVersion.project_id == project_id)
        .order_by(models.ModelVersion.created_at.desc())
    ):
        job = db.get(models.TrainingJob, model.job_id)
        job_architecture = db.get(models.Architecture, job.architecture_id)
        result.append(
            {
                "id": str(model.id),
                "name": f"{job_architecture.family} · entrenamiento {job.id}",
                "version": f"v{model.version}.0.0",
                "family": job_architecture.family,
                "status": model.status,
                "accuracy": (job.accuracy or 0) * 100,
                "date": model.created_at.isoformat(),
                "jobId": str(job.id),
                "checksum": model.checksum,
            }
        )
    return result


@app.post("/api/v1/training-jobs/{job_id}/models", status_code=201)
def create_model_version(
    job_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    job = _accessible_job(db, user, job_id)
    if job.status != "COMPLETED":
        raise HTTPException(status_code=409, detail="Solo se pueden registrar modelos de entrenamientos completados.")
    exists = db.scalar(select(models.ModelVersion.id).where(models.ModelVersion.job_id == job.id))
    if exists:
        raise HTTPException(status_code=409, detail="Este entrenamiento ya tiene una versión registrada.")
    previous_version = db.scalar(
        select(models.ModelVersion.version)
        .where(models.ModelVersion.project_id == job.project_id)
        .order_by(models.ModelVersion.version.desc())
        .limit(1)
    ) or 0
    storage_key = f"job-{job.id}.keras"
    model_path = MODEL_DIR / storage_key
    if not model_path.is_file():
        raise HTTPException(status_code=404, detail="No se encontró el artefacto entrenado.")
    checksum = hashlib.sha256(model_path.read_bytes()).hexdigest()
    version = models.ModelVersion(
        project_id=job.project_id,
        job_id=job.id,
        version=previous_version + 1,
        storage_key=storage_key,
        checksum=checksum,
    )
    db.add(version)
    _audit(db, user, "model.version.created", job.project_id, {"job_id": job.id})
    db.commit()
    return {"id": str(version.id), "version": version.version, "checksum": checksum, "status": version.status}


@app.patch("/api/v1/models/{model_id}/status")
def set_model_status(
    model_id: int,
    status: str,
    user: models.User = Depends(require_roles("Administrador", "Responsable de proyecto", "Revisor")),
    db: Session = Depends(get_db),
):
    if status not in {"Borrador", "Revisado", "Aprobado", "Retirado"}:
        raise HTTPException(status_code=422, detail="Estado de modelo inválido.")
    version = db.get(models.ModelVersion, model_id)
    if version is None:
        raise HTTPException(status_code=404, detail="No se encontró la versión del modelo.")
    _project_access(db, user, version.project_id, write=True)
    version.status = status
    _audit(db, user, "model.status.changed", version.project_id, {"model_id": version.id, "status": status})
    db.commit()
    return {"id": str(version.id), "status": version.status}


@app.get("/api/v1/models/{model_id}/download")
def download_model(
    model_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    version = db.get(models.ModelVersion, model_id)
    if version is None:
        raise HTTPException(status_code=404, detail="No se encontró la versión del modelo.")
    _project_access(db, user, version.project_id)
    path = MODEL_DIR / version.storage_key
    if not path.is_file():
        raise HTTPException(status_code=404, detail="El artefacto del modelo no está disponible.")
    _audit(db, user, "model.downloaded", version.project_id, {"model_id": version.id})
    db.commit()
    family = db.get(models.Architecture, db.get(models.TrainingJob, version.job_id).architecture_id).family.lower()
    return FileResponse(path, filename=f"neurolab-{family}-v{version.version}.keras", media_type="application/octet-stream")


@app.get("/api/v1/projects/{project_id}/audit-events")
def list_audit_events(
    project_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _project_access(db, user, project_id)
    if user.role == "Lector":
        raise HTTPException(status_code=403, detail="Tu rol no permite consultar la auditoría.")
    return [
        {
            "id": row.id,
            "actor_id": row.actor_id,
            "action": row.action,
            "metadata": decode_json(row.metadata_json),
            "created_at": row.created_at.isoformat(),
        }
        for row in db.scalars(
            select(models.AuditEvent)
            .where(models.AuditEvent.project_id == project_id)
            .order_by(models.AuditEvent.created_at.desc())
            .limit(500)
        )
    ]


@app.get("/api/v1/admin/users")
def list_users(
    user: models.User = Depends(require_roles("Administrador")),
    db: Session = Depends(get_db),
):
    return [UserResponse.model_validate(item) for item in db.scalars(select(models.User).order_by(models.User.id))]


@app.patch("/api/v1/admin/users/{user_id}/role")
def update_user_role(
    user_id: int,
    role: str,
    user: models.User = Depends(require_roles("Administrador")),
    db: Session = Depends(get_db),
):
    if role not in ROLES:
        raise HTTPException(status_code=422, detail="Rol no válido.")
    target = db.get(models.User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="No se encontró el usuario.")
    target.role = role
    _audit(db, user, "user.role.changed", metadata={"target_user_id": user_id, "role": role})
    db.commit()
    return UserResponse.model_validate(target)


@app.patch("/api/v1/admin/users/{user_id}/status")
def update_user_status(
    user_id: int,
    status: str,
    user: models.User = Depends(require_roles("Administrador")),
    db: Session = Depends(get_db),
):
    if status not in {"Activo", "Suspendido"}:
        raise HTTPException(status_code=422, detail="Estado de usuario no válido.")
    target = db.get(models.User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="No se encontró el usuario.")
    if target.id == user.id and status != "Activo":
        raise HTTPException(status_code=409, detail="No puedes suspender tu propia cuenta.")
    target.status = status
    _audit(db, user, "user.status.changed", metadata={"target_user_id": user_id, "status": status})
    db.commit()
    return UserResponse.model_validate(target)


DEFAULT_SETTINGS = {"max_active_jobs": "1", "max_upload_mb": "100", "retention_days": "90"}


@app.get("/api/v1/admin/settings")
def read_settings(
    user: models.User = Depends(require_roles("Administrador")),
    db: Session = Depends(get_db),
):
    stored = {setting.key: setting.value for setting in db.scalars(select(models.SystemSetting))}
    return {key: int(stored.get(key, value)) for key, value in DEFAULT_SETTINGS.items()}


@app.patch("/api/v1/admin/settings")
def update_settings(
    body: SettingsUpdate,
    user: models.User = Depends(require_roles("Administrador")),
    db: Session = Depends(get_db),
):
    for key, value in body.model_dump().items():
        setting = db.get(models.SystemSetting, key)
        if setting is None:
            db.add(models.SystemSetting(key=key, value=str(value)))
        else:
            setting.value = str(value)
    _audit(db, user, "system.settings.changed", metadata=body.model_dump())
    db.commit()
    return body.model_dump()


@app.get("/api/v1/admin/audit-events")
def list_global_audit_events(
    user: models.User = Depends(require_roles("Administrador")),
    db: Session = Depends(get_db),
):
    return [
        {
            "id": row.id,
            "actor_id": row.actor_id,
            "project_id": row.project_id,
            "action": row.action,
            "metadata": decode_json(row.metadata_json),
            "created_at": row.created_at.isoformat(),
        }
        for row in db.scalars(select(models.AuditEvent).order_by(models.AuditEvent.created_at.desc()).limit(500))
    ]


@app.get("/api/v1/admin/health")
def admin_health(
    user: models.User = Depends(require_roles("Administrador")),
    db: Session = Depends(get_db),
):
    heartbeat = db.scalar(select(models.WorkerHeartbeat).order_by(models.WorkerHeartbeat.last_seen.desc()).limit(1))
    worker_status = "offline"
    if heartbeat and (datetime.now(timezone.utc) - heartbeat.last_seen.replace(tzinfo=timezone.utc)).total_seconds() < 15:
        worker_status = "online"
    return {"api": "ok", "database": "connected", "worker": worker_status, "ml_engine": "tensorflow-worker"}
