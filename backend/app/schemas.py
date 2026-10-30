import json
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class RegisterRequest(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=12, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserResponse(BaseModel):
    id: int
    email: str
    display_name: str
    role: str
    status: str

    model_config = ConfigDict(from_attributes=True)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=160)
    description: str = Field(default="", max_length=5000)
    family: Literal["CNN"] = "CNN"


class ProjectResponse(BaseModel):
    id: int
    name: str
    description: str
    status: str
    family: str = "CNN"
    owner: str
    progress: int = 0


class CNNLayer(BaseModel):
    type: Literal["Conv2D", "MaxPooling2D", "Flatten", "Dense", "Dropout"]
    filters: int | None = Field(default=None, ge=1, le=512)
    units: int | None = Field(default=None, ge=1, le=4096)
    kernel_size: int | None = Field(default=None, ge=1, le=11)
    activation: Literal["relu", "softmax", "sigmoid", "tanh", "linear"] = "relu"
    rate: float | None = Field(default=None, ge=0.0, le=0.8)


class ArchitectureCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=160)
    input_height: int = Field(ge=16, le=2048)
    input_width: int = Field(ge=16, le=2048)
    input_channels: Literal[1, 3, 4] = 3
    layers: list[CNNLayer] = Field(min_length=3, max_length=32)

    @model_validator(mode="after")
    def validate_cnn_graph(self):
        types = [layer.type for layer in self.layers]
        if types[0] != "Conv2D":
            raise ValueError("Una CNN debe iniciar con una capa Conv2D.")
        if types[-1] != "Dense":
            raise ValueError("Una CNN debe terminar con una capa Dense de salida.")
        if types.count("Flatten") != 1 or types.index("Flatten") < 1:
            raise ValueError("La CNN requiere exactamente una capa Flatten después de las convoluciones.")
        flatten_index = types.index("Flatten")
        if any(t in {"Conv2D", "MaxPooling2D"} for t in types[flatten_index + 1 :]):
            raise ValueError("Las capas convolucionales deben ir antes de Flatten.")
        if any(t == "Flatten" for t in types[:flatten_index] + types[flatten_index + 1 :]):
            raise ValueError("Solo se permite una capa Flatten.")
        if any(t == "Dropout" and self.layers[i].rate is None for i, t in enumerate(types)):
            raise ValueError("Cada capa Dropout necesita rate.")
        if any(t == "Conv2D" and self.layers[i].filters is None for i, t in enumerate(types)):
            raise ValueError("Cada capa Conv2D necesita filters.")
        if any(t == "Dense" and self.layers[i].units is None for i, t in enumerate(types)):
            raise ValueError("Cada capa Dense necesita units.")
        if any(t == "Conv2D" and self.layers[i].kernel_size is None for i, t in enumerate(types)):
            raise ValueError("Cada capa Conv2D necesita kernel_size.")
        return self


class ArchitectureResponse(BaseModel):
    id: int
    project_id: int
    name: str
    family: str
    version: int
    config: dict


class TrainingCreate(BaseModel):
    architecture_id: int
    dataset_id: int
    epochs: int = Field(ge=1, le=500)
    batch_size: int = Field(ge=1, le=512)
    optimizer: Literal["Adam", "SGD", "RMSprop", "Adagrad"] = "Adam"


class ProjectMemberCreate(BaseModel):
    email: EmailStr
    role: Literal["Responsable de proyecto", "Ingeniero de IA", "Revisor", "Lector"]


class SettingsUpdate(BaseModel):
    max_active_jobs: int = Field(ge=1, le=10)
    max_upload_mb: int = Field(ge=10, le=100)
    retention_days: int = Field(ge=7, le=365)


class DatasetResponse(BaseModel):
    id: int
    project_id: int
    name: str
    filename: str
    version: int
    status: str
    metadata: dict


def decode_json(value: str) -> dict:
    result = json.loads(value)
    return result if isinstance(result, dict) else {}


def safe_filename(value: str) -> str:
    name = value.replace("\\", "/").split("/")[-1]
    return re.sub(r"[^a-zA-Z0-9._ -]", "_", name)[:255] or "dataset.zip"
