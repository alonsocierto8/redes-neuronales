# NeuroLab Enterprise — Frontend simulado

Frontend empresarial para gestión y experimentación con redes neuronales artificiales. Proyecto React + TypeScript + Vite, preparado para abrir en Visual Studio Code.

## Requisitos
- Node.js 20 LTS recomendado (Node 18.18+ también puede funcionar).
- npm.
- Visual Studio Code.

## Ejecutar localmente
1. Descomprime `neurolab-enterprise.zip`.
2. Abre la carpeta `neurolab-enterprise` en Visual Studio Code.
3. Abre Terminal → New Terminal.
4. Ejecuta:

```bash
npm install
npm run dev
```

5. Abre la URL local que muestre Vite (normalmente `http://localhost:5173`).

Para comprobar la compilación de producción:

```bash
npm run build
npm run preview
```

## Alcance de esta entrega
Esta entrega implementa **solo el frontend**. No incluye API Python, TensorFlow/Keras, PostgreSQL, autenticación real, almacenamiento remoto, workers ni canal real SSE/WebSocket. Los datos de muestra y las acciones son simulaciones locales en el navegador.

### Módulos de interfaz incluidos
- M01 Inicio / Dashboard.
- M02 Proyectos de IA.
- M03 Fundamentos neuronales.
- M04 Diseñador de arquitecturas.
- M05 Datasets.
- M06 Entrenamientos.
- M07 Evaluación y métricas.
- M08 Registro de modelos.
- M09 Reportes.
- M10 Administración y seguridad (vista de demostración).

### Flujos demostrables
- Navegar por los módulos.
- Buscar y filtrar proyectos, entrenamientos, datasets y modelos.
- Crear un proyecto de demostración.
- Diseñar una arquitectura Feedforward, RNN, CNN o GAN; agregar/eliminar capas y editar parámetros.
- Validar visualmente una arquitectura.
- Seleccionar un dataset de muestra y parámetros de entrenamiento.
- Iniciar una simulación de entrenamiento con progreso y métricas ilustrativas.
- Solicitar cancelación simulada.
- Crear una versión de modelo de demostración.
- Comparar ejecuciones y consultar registros.
- Descargar un CSV de ejemplo desde Reportes.
- Consultar la ficha conceptual de redes neuronales.

## Estructura
```text
neurolab-enterprise/
├── src/
│   ├── app/
│   ├── components/
│   ├── features/
│   ├── lib/
│   ├── types/
│   └── styles/
├── public/
├── index.html
├── package.json
└── README.md
```

## Nota de integración futura
Las operaciones simuladas están separadas en `src/lib/mockApi.ts`. En una siguiente fase puede sustituirse ese adaptador por un cliente API tipado que consuma `/api/v1`, sin presentar las simulaciones como entrenamiento real.
