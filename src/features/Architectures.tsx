import { useMemo, useState } from 'react'
import { ArrowDown, Check, CircleHelp, Layers3, Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { Layer, Project } from '../types'
import type { CnnLayerConfig, NeuralArchitecture } from '../lib/api'
import { PageHeader, Card, CardTitle, Badge, Button } from '../components/Primitives'

const initialLayers: Layer[] = [
  { id: 'conv-1', type: 'Conv2D', units: 32, filters: 32, kernelSize: 3, activation: 'relu', shape: '32 filtros · kernel 3×3' },
  { id: 'pool-1', type: 'MaxPooling2D', units: 0, activation: 'linear', shape: 'Pooling 2×2' },
  { id: 'flatten-1', type: 'Flatten', units: 0, activation: 'linear', shape: 'Aplanamiento' },
  { id: 'output-1', type: 'Dense', units: 2, activation: 'softmax', shape: '2 clases de salida' },
]
const initialFeedforwardLayers: Layer[] = [
  { id: 'dense-hidden', type: 'Dense', units: 16, activation: 'relu', shape: '16 unidades ocultas' },
  { id: 'dense-output', type: 'Dense', units: 2, activation: 'softmax', shape: '2 clases de salida' },
]

export default function Architectures({ projects, onSave }: {
  projects: Project[]
  onSave: (projectId: string, config: NeuralArchitecture) => Promise<void>
}) {
  const [layers, setLayers] = useState<Layer[]>(initialLayers)
  const [selected, setSelected] = useState(initialLayers[0].id)
  const [family, setFamily] = useState<'CNN' | 'Feedforward'>('CNN')
  const [projectId, setProjectId] = useState(projects[0]?.id || '')
  const [name, setName] = useState('CNN de clasificación')
  const [height, setHeight] = useState(64)
  const [width, setWidth] = useState(64)
  const [channels, setChannels] = useState<1 | 3 | 4>(3)
  const [inputFeatures, setInputFeatures] = useState(4)
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const active = layers.find(layer => layer.id === selected)
  const parameters = useMemo(() => layers.reduce((sum, layer) => sum + (layer.filters || layer.units), 0), [layers])

  function updateLayer(id: string, patch: Partial<Layer>) {
    setLayers(current => current.map(layer => layer.id === id ? { ...layer, ...patch } : layer))
    setNotice('')
  }

  function addLayer() {
    const id = `${family.toLowerCase()}-${crypto.randomUUID()}`
    if (family === 'CNN') {
      const layer: Layer = { id, type: 'Conv2D', units: 32, filters: 32, kernelSize: 3, activation: 'relu', shape: '32 filtros · kernel 3×3' }
      const flattenIndex = layers.findIndex(item => item.type === 'Flatten')
      setLayers(current => [...current.slice(0, flattenIndex), layer, ...current.slice(flattenIndex)])
    } else {
      const layer: Layer = { id, type: 'Dense', units: 16, activation: 'relu', shape: '16 unidades ocultas' }
      setLayers(current => [...current.slice(0, -1), layer, ...current.slice(-1)])
    }
    setSelected(id)
  }

  function removeLayer(id: string) {
    if (layers.length <= (family === 'CNN' ? 3 : 2)) {
      setNotice(family === 'CNN'
        ? 'Conserva al menos una capa convolucional, Flatten y una salida Dense.'
        : 'Conserva una capa Dense oculta y una capa Dense de salida.')
      return
    }
    setLayers(current => current.filter(layer => layer.id !== id))
    setSelected(layers.find(layer => layer.id !== id)?.id || '')
    setNotice('')
  }

  async function save() {
    if (!projectId) {
      setNotice('Crea o selecciona un proyecto antes de guardar la CNN.')
      return
    }
    if (family === 'CNN' && (layers[0]?.type !== 'Conv2D' || layers.filter(layer => layer.type === 'Flatten').length !== 1 || layers[layers.length - 1]?.type !== 'Dense')) {
      setNotice('La CNN debe iniciar con Conv2D, tener un Flatten y terminar con una salida Dense.')
      return
    }
    if (family === 'Feedforward' && (layers[0]?.type !== 'Dense' || layers[layers.length - 1]?.type !== 'Dense' || !layers.slice(0, -1).some(layer => layer.type === 'Dense'))) {
      setNotice('Feedforward requiere al menos una capa Dense oculta y una Dense de salida.')
      return
    }
    const output = layers[layers.length - 1]
    if (!output || output.units < 2) {
      setNotice('La capa Dense final debe tener al menos 2 unidades, una por clase.')
      return
    }
    if (output.activation !== 'softmax') {
      setNotice('La capa Dense de salida debe usar softmax para clasificación multiclase.')
      return
    }
    setSaving(true)
    setNotice('')
    try {
      const architectureName = name.trim() || `${family} de clasificación`
      const config: NeuralArchitecture = family === 'CNN'
        ? {
          family: 'CNN',
          name: architectureName,
          input_height: height,
          input_width: width,
          input_channels: channels,
          layers: layers.map((layer): CnnLayerConfig => {
            const activation = layer.activation as CnnLayerConfig['activation']
            if (layer.type === 'Conv2D') return { type: layer.type, filters: layer.filters, kernel_size: layer.kernelSize, activation }
            if (layer.type === 'Dense') return { type: layer.type, units: layer.units, activation }
            if (layer.type === 'Dropout') return { type: layer.type, rate: layer.rate ?? 0.25, activation }
            return { type: layer.type, activation }
          }),
        }
        : {
          family: 'Feedforward',
          name: architectureName,
          input_features: inputFeatures,
          layers: layers.map(layer => {
            const activation = layer.activation as 'relu' | 'softmax' | 'sigmoid' | 'tanh' | 'linear'
            if (layer.type === 'Dense') return { type: layer.type, units: layer.units, activation }
            if (layer.type === 'Dropout') return { type: layer.type, rate: layer.rate ?? 0.25, activation }
            throw new Error('Feedforward solo admite capas Dense y Dropout.')
          }),
        }
      await onSave(projectId, config)
      setNotice(`Arquitectura ${family} validada y guardada con versión.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo guardar la CNN.')
    } finally {
      setSaving(false)
    }
  }

  return <div className="page-wrap">
    <PageHeader eyebrow="M04 · ARCHITECTURE DESIGNER" title="Diseñador de arquitecturas" description="Configura una red Feedforward o CNN, sus entradas, capas y salidas." action={<Button variant="secondary" onClick={() => {const defaults=family==='CNN'?initialLayers:initialFeedforwardLayers;setLayers(defaults);setSelected(defaults[0].id);setNotice('Diseño restablecido.')}} icon={<RotateCcw size={15}/>}>Restablecer</Button>}/>
    <div className="designer-toolbar">
      <label className="inline-select">Proyecto<select value={projectId} onChange={event => setProjectId(event.target.value)}>{projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
      <label className="inline-select">Familia<select value={family} onChange={event => {const next=event.target.value as 'CNN'|'Feedforward';const defaults=next==='CNN'?initialLayers:initialFeedforwardLayers;setFamily(next);setLayers(defaults);setSelected(defaults[0].id);setName(`${next} de clasificación`);setNotice('')}}><option value="Feedforward">Feedforward · datos tabulares</option><option value="CNN">CNN · imágenes</option></select></label>
      <label className="inline-select">Nombre<input value={name} onChange={event => setName(event.target.value)} maxLength={160}/></label>
    </div>
    <div className="designer-grid">
      <Card className="layers-panel">
        <CardTitle title={`Capas de ${family}`} subtitle={`${layers.length} componentes`} action={<button className="small-icon-button" onClick={addLayer} aria-label="Agregar capa"><Plus size={16}/></button>}/>
        <div className="layer-stack">{layers.map((layer, index) => <div key={layer.id}>
          <button className={`layer-node ${selected === layer.id ? 'layer-selected' : ''}`} onClick={() => setSelected(layer.id)}>
            <span className="layer-type-icon layer-type-hidden"><Layers3 size={16}/></span>
            <span className="layer-node-copy"><b>{layer.type}</b><small>{layer.type === 'Conv2D' ? `${layer.filters} filtros · ${layer.activation}` : layer.type === 'Dense' ? `${layer.units} unidades · ${layer.activation}` : layer.shape}</small></span>
            <span className="layer-index">{String(index + 1).padStart(2, '0')}</span>
          </button>
          {index < layers.length - 1 && <div className="layer-connector"><ArrowDown size={14}/></div>}
        </div>)}</div>
        <button className="add-layer-btn" onClick={addLayer}><Plus size={15}/> Añadir {family === 'CNN' ? 'Conv2D' : 'Dense'}</button>
        <div className="layer-hint"><CircleHelp size={14}/> La API valida el orden y los parámetros antes de guardar.</div>
      </Card>
      <Card className="canvas-panel">
        <CardTitle title={`Vista de arquitectura ${family}`} subtitle={family === 'CNN' ? 'Flujo de procesamiento de imágenes' : 'Flujo de clasificación tabular'} action={<Badge tone="blue">{family}</Badge>}/>
        {family === 'CNN' ? <div className="properties-form cnn-input-form">
          <label>Alto (px)<input type="number" min="16" max="2048" value={height} onChange={event => setHeight(Number(event.target.value))}/></label>
          <label>Ancho (px)<input type="number" min="16" max="2048" value={width} onChange={event => setWidth(Number(event.target.value))}/></label>
          <label>Canales<select value={channels} onChange={event => setChannels(Number(event.target.value) as 1 | 3 | 4)}><option value="1">1 · escala de grises</option><option value="3">3 · RGB</option><option value="4">4 · RGBA</option></select></label>
        </div> : <div className="properties-form cnn-input-form"><label>Características de entrada<input type="number" min="1" max="4096" value={inputFeatures} onChange={event => setInputFeatures(Number(event.target.value))}/></label></div>}
        <div className="architecture-canvas"><div className="canvas-grid-bg"/><div className="network-visual">{layers.map((layer, index) => <div className="network-col" key={layer.id}>
          <span className="network-label">{layer.type}</span><div className="network-neurons">{Array.from({ length: Math.min(5, Math.max(2, layer.filters ? 5 : Math.ceil(layer.units / 8))) }, (_, neuron) => <span key={neuron} className={`network-neuron ${selected === layer.id ? 'neuron-selected' : ''}`} onClick={() => setSelected(layer.id)}/>)}</div>
          <span className="network-units">{layer.filters ? `${layer.filters} filtros` : layer.units ? `${layer.units} unidades` : layer.shape}</span>
          {index < layers.length - 1 && <div className="connection-lines">{Array.from({ length: 9 }, (_, line) => <i key={line} style={{ top: `${8 + line * 10}%`, transform: `rotate(${(line - 4) * 4}deg)` }}/>)}</div>}
        </div>)}</div><div className="canvas-legend"><span><i className="legend-dot purple-dot"/> Capa seleccionada</span><span><i className="legend-line"/> Flujo CNN</span></div></div>
        <div className="canvas-summary"><div><span>Modelo</span><b>{family}</b></div><div><span>Capas</span><b>{layers.length}</b></div><div><span>Parámetros*</span><b>{parameters.toLocaleString('es')}</b></div><div><span>Clases salida</span><b>{layers[layers.length - 1]?.units || 0}</b></div></div>
        <p className="tiny-note">*Estimación preliminar. El recuento real lo calcula TensorFlow al construir el modelo.</p>
      </Card>
      <Card className="properties-panel">
        <CardTitle title="Propiedades" subtitle={active?.type || 'Selecciona una capa'}/>
        {active && <div className="properties-form">
          {active.type === 'Conv2D' && <>
            <label>Filtros<input type="number" min="1" max="512" value={active.filters || 32} onChange={event => updateLayer(active.id, { filters: Number(event.target.value) })}/></label>
            <label>Kernel<input type="number" min="1" max="11" value={active.kernelSize || 3} onChange={event => updateLayer(active.id, { kernelSize: Number(event.target.value) })}/></label>
            <label>Activación<select value={active.activation} onChange={event => updateLayer(active.id, { activation: event.target.value })}>{['relu','tanh','sigmoid','linear'].map(value => <option key={value}>{value}</option>)}</select></label>
          </>}
          {active.type === 'Dense' && <>
            <label>Unidades / clases<input type="number" min="2" max="4096" value={active.units} onChange={event => updateLayer(active.id, { units: Number(event.target.value) })}/></label>
            <label>Activación<select value={active.activation} onChange={event => updateLayer(active.id, { activation: event.target.value })}>{(layers[layers.length - 1]?.id === active.id ? ['softmax'] : ['softmax','relu','sigmoid','tanh','linear']).map(value => <option key={value}>{value}</option>)}</select></label>
          </>}
          {active.type === 'Dropout' && <label>Dropout<input type="number" min="0" max="0.8" step="0.05" value={active.rate ?? 0.25} onChange={event => updateLayer(active.id, { rate: Number(event.target.value) })}/></label>}
          {active.type !== 'Flatten' && <div className="property-actions"><Button variant="danger" onClick={() => removeLayer(active.id)} icon={<Trash2 size={14}/>}>Eliminar capa</Button></div>}
        </div>}
        <div className="family-info"><b><CircleHelp size={14}/> Clasificación {family}</b><p>{family === 'CNN' ? 'El ZIP debe contener carpetas por clase.' : 'Las características de entrada deben coincidir con las columnas numéricas del CSV.'} La salida Dense debe tener tantas unidades como clases.</p></div>
      </Card>
    </div>
    <div className="designer-footer"><div className="validation-message">{notice&&<><span className="validation-ok"><Check size={15}/></span>{notice}</>}</div><div className="footer-actions"><Button onClick={save} disabled={saving} icon={<Check size={15}/>}>{saving ? 'Guardando…' : `Validar y guardar ${family}`}</Button></div></div>
  </div>
}
