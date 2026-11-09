import { useState } from 'react'

type Entidad = 'pacientes' | 'profesionales' | 'turnos'
type Formato = 'csv' | 'xlsx' | 'xls'

interface ErrorFila {
  fila: number
  campo?: string
  codigo: string
  mensaje: string
}

interface ResultadoPreview {
  entidad: Entidad
  formato: Formato
  totalFilas: number
  filasValidas: number
  filasInvalidas: number
  errores: ErrorFila[]
  muestrasSeguras: Array<{ fila: number; campos: string[] }>
  persistido: false
}

interface ResultadoConfirmacion {
  entidad: Entidad
  formato: Formato
  totalFilas: number
  insertadas: number
  rechazadas: number
  errores: ErrorFila[]
}

function detectarFormato(nombre: string): Formato {
  const n = nombre.toLowerCase()
  if (n.endsWith('.xlsx')) return 'xlsx'
  if (n.endsWith('.xls')) return 'xls'
  return 'csv'
}

async function leerContenido(file: File, formato: Formato): Promise<string> {
  if (formato === 'csv') return await file.text()
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result ?? ''))
    r.onerror = () => reject(new Error('lectura fallida'))
    r.readAsDataURL(file)
  })
  const idx = dataUrl.indexOf(',')
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl
}

async function apiPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string }
  if (!res.ok) {
    const msg = (data as { message?: string; error?: string }).message || (data as { error?: string }).error || `error ${res.status}`
    throw new Error(msg)
  }
  return data
}

export function MigracionDemo() {
  const [token, setToken] = useState('')
  const [entidad, setEntidad] = useState<Entidad>('profesionales')
  const [formato, setFormato] = useState<Formato>('csv')
  const [file, setFile] = useState<File | null>(null)
  const [mapeoText, setMapeoText] = useState('')
  const [preview, setPreview] = useState<ResultadoPreview | null>(null)
  const [confirm, setConfirm] = useState<ResultadoConfirmacion | null>(null)
  const [msg, setMsg] = useState<string>('')
  const [busy, setBusy] = useState(false)

  function parseMapeo(): Record<string, string> | undefined {
    const t = mapeoText.trim()
    if (!t) return undefined
    try {
      const o = JSON.parse(t) as unknown
      if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, string>
    } catch {
      /* ignorar, se enviará sin mapeo válido */
    }
    return undefined
  }

  async function payloadActual() {
    if (!file) throw new Error('seleccione un archivo')
    const contenido = await leerContenido(file, formato)
    return { entidad, formato, contenido, mapeo: parseMapeo() }
  }

  async function onFile(f: File | null) {
    setFile(f)
    setPreview(null)
    setConfirm(null)
    if (f) setFormato(detectarFormato(f.name))
  }

  async function cargarDemo() {
    setBusy(true); setMsg(''); setPreview(null); setConfirm(null)
    try {
      await apiPost('/api/utilidades/demo', token, {})
      setMsg('Demo ficticia cargada.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'error')
    } finally { setBusy(false) }
  }

  async function hacerPreview() {
    setBusy(true); setMsg(''); setConfirm(null)
    try {
      const res = await apiPost<ResultadoPreview>('/api/utilidades/importacion/preview', token, await payloadActual())
      setPreview(res)
      setMsg(res.persistido === false ? 'Preview generado (sin persistir).' : 'Preview listo.')
    } catch (e) {
      setPreview(null)
      setMsg(e instanceof Error ? e.message : 'error')
    } finally { setBusy(false) }
  }

  async function confirmarImport() {
    setBusy(true); setMsg('')
    try {
      const res = await apiPost<ResultadoConfirmacion>('/api/utilidades/importacion/confirmar', token, await payloadActual())
      setConfirm(res)
      setMsg(`Importación confirmada: ${res.insertadas} insertada(s), ${res.rechazadas} rechazada(s).`)
    } catch (e) {
      setConfirm(null)
      setMsg(e instanceof Error ? e.message : 'error')
    } finally { setBusy(false) }
  }

  return (
    <section aria-label="Demo y migración" style={{ border: '1px solid #ccc', padding: 12, marginTop: 12 }}>
      <h2>Demo y migración (admin)</h2>
      <p style={{ fontSize: 12 }}>Requiere token Bearer de administración. No ingrese datos reales en demos/pruebas.</p>
      <label>
        Token admin
        <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bearer token (solo valor)" style={{ display: 'block', width: '100%', maxWidth: 520 }} />
      </label>
      <div style={{ marginTop: 8 }}>
        <button type="button" onClick={cargarDemo} disabled={busy}>Cargar demo ficticia</button>
      </div>
      <hr />
      <label>
        Entidad
        <select value={entidad} onChange={(e) => setEntidad(e.target.value as Entidad)}>
          <option value="profesionales">profesionales</option>
          <option value="pacientes">pacientes</option>
          <option value="turnos">turnos</option>
        </select>
      </label>{' '}
      <label>
        Formato
        <select value={formato} onChange={(e) => setFormato(e.target.value as Formato)}>
          <option value="csv">csv</option>
          <option value="xlsx">xlsx</option>
          <option value="xls">xls</option>
        </select>
      </label>
      <div style={{ marginTop: 8 }}>
        <input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} />
      </div>
      <label style={{ display: 'block', marginTop: 8 }}>
        Mapeo JSON opcional (destino: columna origen)
        <textarea value={mapeoText} onChange={(e) => setMapeoText(e.target.value)} rows={2} style={{ display: 'block', width: '100%', maxWidth: 520 }} placeholder='{"nombre":"Nombre"}' />
      </label>
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <button type="button" onClick={hacerPreview} disabled={busy || !file}>Preview</button>
        <button type="button" onClick={confirmarImport} disabled={busy || !file}>Confirmar importación</button>
      </div>
      {msg && <p role="status">{msg}</p>}
      {preview && (
        <div>
          <h3>Preview</h3>
          <p>Total: {preview.totalFilas} · Válidas: {preview.filasValidas} · Inválidas: {preview.filasInvalidas} · Persistido: {String(preview.persistido)}</p>
          {preview.errores.length > 0 && (
            <ul>
              {preview.errores.slice(0, 50).map((er, i) => (
                <li key={i}>Fila {er.fila}{er.campo ? ` [${er.campo}]` : ''}: {er.codigo} - {er.mensaje}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {confirm && (
        <div>
          <h3>Confirmación</h3>
          <p>Insertadas: {confirm.insertadas} · Rechazadas: {confirm.rechazadas}</p>
          {confirm.errores.length > 0 && (
            <ul>
              {confirm.errores.slice(0, 50).map((er, i) => (
                <li key={i}>Fila {er.fila}{er.campo ? ` [${er.campo}]` : ''}: {er.codigo} - {er.mensaje}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
