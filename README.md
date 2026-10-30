# NeuroLab Enterprise

Aplicación para diseñar, entrenar, evaluar y versionar clasificadores neuronales. El MVP ejecuta arquitecturas **Feedforward** con datos tabulares CSV y **CNN** con imágenes; RNN y GAN siguen siendo contenido conceptual, no motores de entrenamiento disponibles.

## Requisitos

- Node.js 20 LTS.
- Python 3.11 o 3.12 para instalar TensorFlow.
- npm.

## Inicio local

En una terminal, instala y ejecuta la interfaz:

```bash
npm install
npm run dev
```

En otra terminal, desde la raíz:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
export NEUROLAB_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
uvicorn backend.app.main:app --reload --port 8000
```

En una tercera terminal instala TensorFlow e inicia el worker:

```bash
source .venv/bin/activate
python -m pip install -r backend/requirements-ml.txt
cd backend
python worker.py
```

La interfaz está en `http://localhost:5173`, la API en `http://localhost:8000` y su esquema OpenAPI en `/api/v1/openapi.json`. Vite reenvía `/api/v1` a la API local.

La configuración local predeterminada guarda datos en SQLite y archivos en `backend/data`. Para otro motor se puede definir `DATABASE_URL`; para despliegues con PostgreSQL hay que instalar su driver correspondiente. `NEUROLAB_SECRET_KEY` debe ser estable y secreto en cualquier entorno persistente: si se omite, la API genera una clave nueva al arrancar.

## Flujo compatible

1. Registra una cuenta e inicia sesión. La primera cuenta recibe el rol Administrador.
2. Crea un proyecto y una arquitectura Feedforward o CNN.
3. Carga datos del mismo tipo:
   - **Feedforward:** CSV UTF-8 con encabezados únicos, entradas numéricas y una columna objetivo categórica. Cada clase debe incluir al menos tres filas. Indica el nombre exacto de la columna objetivo.
   - **CNN:** ZIP con imágenes agrupadas en carpetas por clase.
4. Al validar la carga, NeuroLab crea una arquitectura inicial compatible: Feedforward usa el número de columnas y clases del CSV; CNN redimensiona las imágenes a 64×64 RGB y crea una salida por clase. Puedes editarla después en el diseñador.
5. Selecciona el dataset y su arquitectura generada (se preselecciona automáticamente), y envía el entrenamiento.
6. El worker TensorFlow persiste progreso y métricas; Feedforward separa conjuntos de entrenamiento, validación y prueba.
7. Consulta métricas, registra una versión del artefacto y exporta el informe.

El límite de carga predeterminado es 100 MB. Los trabajos requieren que el proceso worker esté activo. Si se interrumpe SSE, la interfaz vuelve a consultar el estado y reintenta la conexión.

## Pruebas y compilación

```bash
npm test
npm run build
python -m pip install -r backend/requirements-dev.txt
python -m pytest -q backend/tests
```

Las pruebas del backend usan SQLite temporal y no necesitan TensorFlow. Para ejecutar entrenamientos reales instala `backend/requirements-ml.txt` en el entorno del worker.

## Alcance y trabajo pendiente de producción

La API implementa autenticación, permisos por proyecto, auditoría, administración, cargas, cola persistida en base de datos, seguimiento SSE y registro de modelos. La pantalla de administración consume los endpoints protegidos; la verificación de permisos sigue realizándose en el servidor.

Este repositorio aún no incluye configuración Docker/CI, migraciones de esquema, almacenamiento de objetos, cuotas por usuario/proyecto, aislamiento de workers, política automatizada de retención ni procedimientos de backup/restore. SQLite y el almacenamiento local son adecuados para desarrollo, no para una instalación empresarial multiinstancia. Feedforward y CNN son las familias entrenables; RNN y GAN se habilitarán cuando cuenten con validación y worker propios.
