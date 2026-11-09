export type PortalTurno = {
  id: string;
  profesional_id: string;
  sillon_id: string;
  prestacion_id: string | null;
  inicio: string;
  fin: string;
  estado: string;
  origen: string;
};

export type PortalPresupuesto = {
  id: string;
  turno_id: string | null;
  estado: string;
  total_centavos: number;
  cobertura_centavos: number;
  saldo_centavos: number;
  moneda: string;
  created_at: string;
  updated_at: string;
};

export type PortalDocumento = {
  id: string;
  nombre?: string;
  tipo?: string;
  disponible?: boolean;
};

export class PortalApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; message?: string };
    const code = typeof err.error === 'string' ? err.error : 'error';
    const message =
      typeof err.message === 'string' && err.message ? err.message : 'No se pudo completar la operación.';
    throw new PortalApiError(res.status, code, message);
  }
  return data as T;
}

export const portalApi = {
  turnos: (token: string) => request<{ turnos: PortalTurno[] }>('/api/public/portal/turnos', token),
  presupuestos: (token: string) =>
    request<{ presupuestos: PortalPresupuesto[] }>('/api/public/portal/presupuestos', token),
  documentos: (token: string) =>
    request<{ documentos: PortalDocumento[] }>('/api/public/portal/documentos', token),
  confirmar: (token: string, id: string) =>
    request<{ estado: string }>(`/api/public/portal/turnos/${encodeURIComponent(id)}/confirmar`, token, {
      method: 'POST',
      body: '{}',
    }),
  cancelar: (token: string, id: string) =>
    request<{ estado: string }>(`/api/public/portal/turnos/${encodeURIComponent(id)}/cancelar`, token, {
      method: 'POST',
      body: '{}',
    }),
  reprogramar: (token: string, id: string, nuevoInicio: string, nuevoFin: string) =>
    request<{ estado: string; turnoReprogramado?: string }>(
      `/api/public/portal/turnos/${encodeURIComponent(id)}/reprogramar`,
      token,
      { method: 'POST', body: JSON.stringify({ nuevo_inicio: nuevoInicio, nuevo_fin: nuevoFin }) },
    ),
};
