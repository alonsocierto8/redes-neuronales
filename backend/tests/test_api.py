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
    architecture = client.post(
        f"/api/v1/projects/{project['id']}/architectures",
        headers=auth(token),
        json={
            "name": "CNN 2 clases",
            "input_height": 64,
            "input_width": 64,
            "input_channels": 3,
            "layers": [
                {"type": "Conv2D", "filters": 32, "kernel_size": 3},
                {"type": "Flatten"},
                {"type": "Dense", "units": 2, "activation": "softmax"},
            ],
        },
    )
    assert architecture.status_code == 201
    job = client.post(
        f"/api/v1/projects/{project['id']}/training-jobs",
        headers=auth(token),
        json={
            "architecture_id": architecture.json()["id"],
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
