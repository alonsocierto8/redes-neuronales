import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app import main
from backend.app.database import Base, get_db


@pytest.fixture()
def client():
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestSession = sessionmaker(bind=test_engine, autoflush=False, expire_on_commit=False)
    Base.metadata.create_all(bind=test_engine)

    def override_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    main.app.dependency_overrides[get_db] = override_db
    with TestClient(main.app) as test_client:
        yield test_client
    main.app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=test_engine)
    test_engine.dispose()


def register(client: TestClient, email: str):
    response = client.post(
        "/api/v1/auth/register",
        json={"email": email, "display_name": "NeuroLab User", "password": "secure-password-123"},
    )
    assert response.status_code == 201
    return response.json()["access_token"]


def auth(token: str):
    return {"Authorization": f"Bearer {token}"}


def image_dataset_zip() -> bytes:
    file = io.BytesIO()
    with zipfile.ZipFile(file, "w") as archive:
        archive.writestr("images/class-a/one.png", b"sample")
        archive.writestr("images/class-b/two.png", b"sample")
    return file.getvalue()


def tabular_classification_csv() -> bytes:
    rows = ["temperature,humidity,label"]
    for index in range(6):
        rows.append(f"{18 + index},{35 + index},cold")
        rows.append(f"{28 + index},{55 + index},warm")
    return "\n".join(rows).encode()


def test_registration_and_project_membership_are_required(client):
    token = register(client, "owner@example.com")
    project = client.post(
        "/api/v1/projects",
        headers=auth(token),
        json={"name": "Clasificador", "description": "CNN de productos", "family": "CNN"},
    )
    assert project.status_code == 201
    assert project.json()["family"] == "CNN"

    outsider = register(client, "outsider@example.com")
    assert client.get(f"/api/v1/projects/{project.json()['id']}", headers=auth(outsider)).status_code == 404
    assert client.get("/api/v1/projects").status_code == 401


def test_architecture_rejects_non_cnn_and_invalid_layer_order(client):
    token = register(client, "architect@example.com")
    project = client.post(
        "/api/v1/projects",
        headers=auth(token),
        json={"name": "CNN proyecto", "family": "CNN"},
    ).json()
    response = client.post(
        f"/api/v1/projects/{project['id']}/architectures",
        headers=auth(token),
        json={
            "name": "Bad model",
            "family": "RNN",
            "input_height": 64,
            "input_width": 64,
            "input_channels": 3,
            "layers": [],
        },
    )
    assert response.status_code == 422


def test_upload_requires_safe_image_zip_and_records_metadata(client):
    token = register(client, "dataset@example.com")
    project = client.post(
        "/api/v1/projects",
        headers=auth(token),
        json={"name": "CNN proyecto", "family": "CNN"},
    ).json()
    bad = client.post(
        f"/api/v1/projects/{project['id']}/datasets",
        headers=auth(token),
        data={"name": "bad"},
        files={"file": ("dataset.zip", b"not a zip", "application/zip")},
    )
    assert bad.status_code == 400

    uploaded = client.post(
        f"/api/v1/projects/{project['id']}/datasets",
        headers=auth(token),
        data={"name": "Productos"},
        files={"file": ("products.zip", image_dataset_zip(), "application/zip")},
    )
    assert uploaded.status_code == 201
    assert uploaded.json()["metadata"]["classes"] == ["class-a", "class-b"]
    architectures = client.get(
        f"/api/v1/projects/{project['id']}/architectures",
        headers=auth(token),
    )
    assert architectures.status_code == 200
    generated = architectures.json()[0]
    assert generated["family"] == "CNN"
    assert generated["config"]["generated_for_dataset_id"] == uploaded.json()["id"]
    assert generated["config"]["layers"][-1]["units"] == 2


def test_training_requires_matching_cnn_output_and_dataset(client):
    token = register(client, "training@example.com")
    project = client.post(
        "/api/v1/projects",
        headers=auth(token),
        json={"name": "CNN proyecto", "family": "CNN"},
    ).json()
    dataset = client.post(
        f"/api/v1/projects/{project['id']}/datasets",
        headers=auth(token),
        data={"name": "Productos"},
        files={"file": ("products.zip", image_dataset_zip(), "application/zip")},
    ).json()
    architectures = client.get(
        f"/api/v1/projects/{project['id']}/architectures",
        headers=auth(token),
    )
    generated = architectures.json()[0]
    job = client.post(
        f"/api/v1/projects/{project['id']}/training-jobs",
        headers=auth(token),
        json={
            "architecture_id": generated["id"],
            "dataset_id": dataset["id"],
            "epochs": 4,
            "batch_size": 16,
            "optimizer": "Adam",
        },
    )
    assert job.status_code == 202
    assert job.json()["family"] == "CNN"
    assert job.json()["status"] == "En cola"

    wrong_output = client.post(
        f"/api/v1/projects/{project['id']}/architectures",
        headers=auth(token),
        json={
            "name": "CNN salida incorrecta",
            "input_height": 64,
            "input_width": 64,
            "input_channels": 3,
            "layers": [
                {"type": "Conv2D", "filters": 32, "kernel_size": 3},
                {"type": "Flatten"},
                {"type": "Dense", "units": 5, "activation": "softmax"},
            ],
        },
    ).json()
    invalid_job = client.post(
        f"/api/v1/projects/{project['id']}/training-jobs",
        headers=auth(token),
        json={
            "architecture_id": wrong_output["id"],
            "dataset_id": dataset["id"],
            "epochs": 4,
            "batch_size": 16,
            "optimizer": "Adam",
        },
    )
    assert invalid_job.status_code == 400


def test_feedforward_csv_architecture_and_training_are_supported(client):
    token = register(client, "feedforward@example.com")
    project = client.post(
        "/api/v1/projects",
        headers=auth(token),
        json={"name": "Clasificación tabular", "family": "CNN"},
    ).json()
    uploaded = client.post(
        f"/api/v1/projects/{project['id']}/datasets",
        headers=auth(token),
        data={"name": "Temperaturas", "family": "Feedforward", "target_column": "label"},
        files={"file": ("temperatures.csv", tabular_classification_csv(), "text/csv")},
    )
    assert uploaded.status_code == 201
    dataset = uploaded.json()
    assert dataset["metadata"]["family"] == "Feedforward"
    assert dataset["metadata"]["feature_names"] == ["temperature", "humidity"]
    assert dataset["metadata"]["classes"] == ["cold", "warm"]

    generated_architecture = client.get(
        f"/api/v1/projects/{project['id']}/architectures",
        headers=auth(token),
    )
    assert generated_architecture.status_code == 200
    generated = generated_architecture.json()[0]
    assert generated["family"] == "Feedforward"
    assert generated["config"]["generated_for_dataset_id"] == dataset["id"]
    assert generated["config"]["input_features"] == 2
    assert generated["config"]["layers"][-1]["units"] == 2
    assert generated["config"]["layers"][-1]["activation"] == "softmax"

    job = client.post(
        f"/api/v1/projects/{project['id']}/training-jobs",
        headers=auth(token),
        json={
            "architecture_id": generated["id"],
            "dataset_id": dataset["id"],
            "epochs": 2,
            "batch_size": 4,
            "optimizer": "Adam",
        },
    )
    assert job.status_code == 202
    assert job.json()["family"] == "Feedforward"
    assert job.json()["status"] == "En cola"

    invalid_output = client.post(
        f"/api/v1/projects/{project['id']}/architectures",
        headers=auth(token),
        json={
            "name": "Salida Feedforward incompatible",
            "family": "Feedforward",
            "input_features": 2,
            "layers": [
                {"type": "Dense", "units": 8, "activation": "relu"},
                {"type": "Dense", "units": 2, "activation": "relu"},
            ],
        },
    )
    assert invalid_output.status_code == 422


def test_feedforward_upload_rejects_non_numeric_features(client):
    token = register(client, "invalid-csv@example.com")
    project = client.post(
        "/api/v1/projects",
        headers=auth(token),
        json={"name": "Dataset inválido", "family": "CNN"},
    ).json()
    response = client.post(
        f"/api/v1/projects/{project['id']}/datasets",
        headers=auth(token),
        data={"name": "CSV inválido", "family": "Feedforward", "target_column": "label"},
        files={
            "file": (
                "invalid.csv",
                b"feature,label\ntext,a\ntext,a\ntext,b\n",
                "text/csv",
            )
        },
    )
    assert response.status_code == 400
    assert "numérica" in response.json()["detail"]


def test_admin_settings_and_user_controls_are_persisted_and_protected(client):
    admin_token = register(client, "admin@example.com")
    member_token = register(client, "member@example.com")
    assert client.get("/api/v1/admin/users", headers=auth(member_token)).status_code == 403

    settings = client.patch(
        "/api/v1/admin/settings",
        headers=auth(admin_token),
        json={"max_active_jobs": 2, "max_upload_mb": 50, "retention_days": 30},
    )
    assert settings.status_code == 200
    assert client.get("/api/v1/admin/settings", headers=auth(admin_token)).json() == {
        "max_active_jobs": 2,
        "max_upload_mb": 50,
        "retention_days": 30,
    }

    users = client.get("/api/v1/admin/users", headers=auth(admin_token)).json()
    member = next(user for user in users if user["email"] == "member@example.com")
    changed = client.patch(
        f"/api/v1/admin/users/{member['id']}/role?role=Revisor",
        headers=auth(admin_token),
    )
    assert changed.status_code == 200
    assert changed.json()["role"] == "Revisor"
    events = client.get("/api/v1/admin/audit-events", headers=auth(admin_token)).json()
    assert any(event["action"] == "system.settings.changed" for event in events)
