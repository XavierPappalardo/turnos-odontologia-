import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PortalApiError,
  portalApi,
  type PortalDocumento,
  type PortalPresupuesto,
  type PortalTurno,
} from './api';
import './portal.css';

function readTokenFromLocation(): string {
  // Prefer fragment to reduce accidental exposure in server logs/history.
  const hash = window.location.hash.replace(/^#/, '');
  const hashParams = new URLSearchParams(hash);
  const fromHash = hashParams.get('token') ?? hashParams.get('t');
  if (fromHash) return fromHash.trim();
  const search = new URLSearchParams(window.location.search);
  return (search.get('token') ?? search.get('t') ?? '').trim();
}

function formatFecha(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatArs(centavos: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(centavos / 100);
}

function localDateTimeToIso(value: string): string {
  // datetime-local is local time without zone; convert to ISO UTC for backend.
  return new Date(value).toISOString();
}

function safeErrorMessage(err: unknown): string {
  const status =
    err instanceof PortalApiError ? err.status : typeof (err as { status?: unknown } | null)?.status === 'number' ? (err as { status: number }).status : undefined;
  if (status === 401) return 'El enlace o token no es válido o expiró.';
  if (status === 403) return 'No tenés permiso para realizar esta acción.';
  if (status === 404) return 'No se encontró el recurso solicitado.';
  if (status === 409) return 'No se pudo completar: hay un conflicto o el estado cambió.';
  if (status === 429) return 'Demasiadas solicitudes. Intentá nuevamente en unos minutos.';
  if (typeof status === 'number' && status >= 400 && status < 500) return 'No se pudo completar la solicitud.';
  return 'Ocurrió un error. Intentá nuevamente.';
}

export function PortalPaciente() {
  const [tokenInput, setTokenInput] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [turnos, setTurnos] = useState<PortalTurno[]>([]);
  const [presupuestos, setPresupuestos] = useState<PortalPresupuesto[]>([]);
  const [documentos, setDocumentos] = useState<PortalDocumento[]>([]);
  const [reprogramando, setReprogramando] = useState<string | null>(null);
  const [nuevoInicio, setNuevoInicio] = useState('');
  const [nuevoFin, setNuevoFin] = useState('');

  useEffect(() => {
    const t = readTokenFromLocation();
    if (t) {
      setToken(t);
      setTokenInput(t);
      // Clear token from URL after reading to reduce exposure; do not log it.
      try {
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch {
        // ignore
      }
    }
  }, []);

  const cargar = useCallback(async (activeToken: string, opts?: { clearNotice?: boolean }) => {
    setLoading(true);
    setError(null);
    if (opts?.clearNotice !== false) setNotice(null);
    try {
      const [tRes, pRes, dRes] = await Promise.all([
        portalApi.turnos(activeToken),
        portalApi.presupuestos(activeToken),
        portalApi.documentos(activeToken),
      ]);
      setTurnos(tRes.turnos);
      setPresupuestos(pRes.presupuestos);
      setDocumentos(dRes.documentos);
    } catch (err) {
      setError(safeErrorMessage(err));
      setTurnos([]);
      setPresupuestos([]);
      setDocumentos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) void cargar(token);
  }, [token, cargar]);

  const onIngresar = (e: React.FormEvent) => {
    e.preventDefault();
    const t = tokenInput.trim();
    if (!t) {
      setError('Ingresá el enlace o token de acceso.');
      return;
    }
    setToken(t);
  };

  const runAction = async (fn: () => Promise<void>, okMsg: string) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await cargar(token, { clearNotice: false });
      setNotice(okMsg);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const puedeGestionar = (estado: string) => estado === 'reservado' || estado === 'confirmado';

  const resumenTurnos = useMemo(
    () => (turnos.length === 0 ? 'No hay turnos para mostrar.' : `${turnos.length} turno(s)`),
    [turnos.length],
  );

  return (
    <section className="portal" aria-labelledby="portal-title">
      <h2 id="portal-title">Portal del paciente</h2>
      <p className="portal-subtitle">Consultá tus turnos y presupuestos, o gestioná tus turnos con tu enlace de acceso.</p>

      {!token ? (
        <form className="portal-card portal-access" onSubmit={onIngresar}>
          <label htmlFor="portal-token">Enlace o token de acceso</label>
          <input
            id="portal-token"
            name="portal-token"
            type="password"
            autoComplete="off"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Pegá tu token de acceso"
          />
          <button type="submit">Ingresar</button>
        </form>
      ) : (
        <div className="portal-actions-top">
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setToken('');
              setTokenInput('');
              setTurnos([]);
              setPresupuestos([]);
              setDocumentos([]);
              setError(null);
              setNotice(null);
            }}
          >
            Cerrar acceso
          </button>
          <button type="button" onClick={() => void cargar(token)} disabled={loading}>
            Actualizar
          </button>
        </div>
      )}

      {error ? <p className="portal-message error" role="alert">{error}</p> : null}
      {notice ? <p className="portal-message ok" role="status">{notice}</p> : null}
      {loading ? <p className="portal-message" aria-live="polite">Cargando…</p> : null}

      {token ? (
        <div className="portal-grid">
          <article className="portal-card">
            <h3>Mis turnos</h3>
            <p className="portal-meta">{resumenTurnos}</p>
            {turnos.length === 0 ? null : (
              <ul className="portal-list">
                {turnos.map((t) => (
                  <li key={t.id} className="portal-item">
                    <div className="portal-item-main">
                      <strong>{formatFecha(t.inicio)}</strong>
                      <span className="portal-badge">{t.estado}</span>
                    </div>
                    <div className="portal-item-sub">Fin: {formatFecha(t.fin)}</div>
                    {puedeGestionar(t.estado) ? (
                      <div className="portal-item-actions">
                        <button type="button" onClick={() => void runAction(() => portalApi.confirmar(token, t.id).then(() => undefined), 'Turno confirmado.')}>
                          Confirmar
                        </button>
                        <button type="button" className="secondary" onClick={() => void runAction(() => portalApi.cancelar(token, t.id).then(() => undefined), 'Turno cancelado.')}>
                          Cancelar
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            setReprogramando(t.id);
                            setNuevoInicio('');
                            setNuevoFin('');
                          }}
                        >
                          Reprogramar
                        </button>
                      </div>
                    ) : null}
                    {reprogramando === t.id ? (
                      <form
                        className="portal-reprogram"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!nuevoInicio || !nuevoFin) {
                            setError('Completá el nuevo inicio y fin.');
                            return;
                          }
                          void runAction(async () => {
                            await portalApi.reprogramar(token, t.id, localDateTimeToIso(nuevoInicio), localDateTimeToIso(nuevoFin));
                            setReprogramando(null);
                          }, 'Turno reprogramado.');
                        }}
                      >
                        <label>
                          Nuevo inicio
                          <input type="datetime-local" value={nuevoInicio} onChange={(e) => setNuevoInicio(e.target.value)} required />
                        </label>
                        <label>
                          Nuevo fin
                          <input type="datetime-local" value={nuevoFin} onChange={(e) => setNuevoFin(e.target.value)} required />
                        </label>
                        <div className="portal-item-actions">
                          <button type="submit">Guardar</button>
                          <button type="button" className="secondary" onClick={() => setReprogramando(null)}>Cancelar</button>
                        </div>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="portal-card">
            <h3>Mis presupuestos</h3>
            {presupuestos.length === 0 ? <p className="portal-meta">No hay presupuestos para mostrar.</p> : (
              <ul className="portal-list">
                {presupuestos.map((p) => (
                  <li key={p.id} className="portal-item">
                    <div className="portal-item-main">
                      <strong>{p.estado}</strong>
                      <span>{formatArs(p.total_centavos)}</span>
                    </div>
                    <div className="portal-item-sub">Saldo: {formatArs(p.saldo_centavos)} · Cobertura: {formatArs(p.cobertura_centavos)}</div>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="portal-card">
            <h3>Documentos</h3>
            {documentos.length === 0 ? <p className="portal-meta">No hay documentos disponibles.</p> : (
              <ul className="portal-list">
                {documentos.map((d) => (
                  <li key={d.id} className="portal-item">{d.nombre ?? d.tipo ?? 'Documento'}</li>
                ))}
              </ul>
            )}
          </article>
        </div>
      ) : null}
    </section>
  );
}
