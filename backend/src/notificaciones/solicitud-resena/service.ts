/**
 * Servicio solicitud de reseña post-atención (C-19).
 * Simulado (sin credenciales reales), dedupe, sin PHI en logs/errores/respuestas.
 */
import type { DatabaseSync } from 'node:sqlite';
import { AppError } from '../../shared/errors.js';
import type { AppConfig, SolicitudResenaConfig } from '../../shared/config.js';
import { TurnoRepository } from '../../agenda/turno.repository.js';
import { enviarSolicitudResenaSimulada } from './adapter.js';
import { SolicitudResenaRepository, type SolicitudResenaRow } from './repositorio.js';

export interface ResultadoSolicitudResena {
  turno_id: string;
  estado: 'enviado_simulado' | 'omitido' | 'fallido';
  motivo?: string;
  solicitud_id?: string;
  canal?: 'whatsapp' | 'email';
}

function configValida(c: SolicitudResenaConfig): boolean {
  return (
    typeof c.linkResena === 'string' &&
    c.linkResena.trim().length > 0 &&
    (c.canalPredeterminado === 'whatsapp' || c.canalPredeterminado === 'email') &&
    Number.isInteger(c.demoraMinutos) &&
    c.demoraMinutos >= 0 &&
    Number.isInteger(c.ventanaDedupeHoras) &&
    c.ventanaDedupeHoras > 0 &&
    Number.isInteger(c.maxSolicitudesPorLote) &&
    c.maxSolicitudesPorLote > 0
  );
}

function dedupeClave(turnoId: string): string {
  return `resena:turno:${turnoId}`;
}

function nombreDeError(err: unknown): string {
  return err instanceof Error ? err.name : 'desconocido';
}

function aDto(row: SolicitudResenaRow) {
  return {
    id: row.id,
    turno_id: row.turno_id,
    paciente_id: row.paciente_id,
    canal: row.canal,
    estado: row.estado,
    motivo_omision: row.motivo_omision,
    dedupe_clave: row.dedupe_clave,
    ventana_hasta: row.ventana_hasta,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class SolicitudResenaService {
  private readonly repo: SolicitudResenaRepository;
  private readonly turnos: TurnoRepository;
  private readonly solicitudResena: SolicitudResenaConfig;

  constructor(db: DatabaseSync, config: Pick<AppConfig, 'solicitudResena'> | SolicitudResenaConfig) {
    this.repo = new SolicitudResenaRepository(db);
    this.turnos = new TurnoRepository(db);
    this.solicitudResena =
      'solicitudResena' in config ? (config as Pick<AppConfig, 'solicitudResena'>).solicitudResena : config;
  }

  procesarSolicitudParaTurnoAtendido(turnoId: string, ahoraIso = new Date().toISOString()): ResultadoSolicitudResena {
    const c = this.solicitudResena;
    if (!c.habilitado) {
      return { turno_id: turnoId, estado: 'omitido', motivo: 'deshabilitado' };
    }
    if (!configValida(c)) {
      // Config inválida: registrar fallo tipado seguro (sin exponer secretos/detalles).
      const turno = this.turnos.findById(turnoId);
      if (turno?.estado === 'atendido') {
        const row = this.repo.registrar({
          turno_id: turnoId,
          paciente_id: turno.paciente_id,
          canal: c.canalPredeterminado === 'email' ? 'email' : 'whatsapp',
          link_ref: 'invalida',
          estado: 'fallido',
          motivo_omision: 'config_link_invalida',
          dedupe_clave: dedupeClave(turnoId),
          ventana_hasta: null,
          detalle_json: '{}',
        });
        return { turno_id: turnoId, estado: 'fallido', motivo: 'config_link_invalida', solicitud_id: row.id };
      }
      return { turno_id: turnoId, estado: 'fallido', motivo: 'config_link_invalida' };
    }

    const turno = this.turnos.findById(turnoId);
    if (!turno || turno.estado !== 'atendido') {
      return { turno_id: turnoId, estado: 'omitido', motivo: 'turno_no_elegible' };
    }

    // Dedupe por turno: una solicitud efectiva por atención (no duplica registro efectivo).
    if (this.repo.existeParaTurno(turnoId)) {
      return { turno_id: turnoId, estado: 'omitido', motivo: 'duplicado_turno' };
    }

    // Demora opcional: si la atención es reciente, no bloquear; registrar como omitido diferido solo si aplica.
    // (C-19 diseño: evaluación determinista al transicionar; demora 0 por defecto.)
    if (c.demoraMinutos > 0) {
      const finMs = new Date(turno.fin).getTime();
      const ahoraMs = new Date(ahoraIso).getTime();
      if (Number.isFinite(finMs) && Number.isFinite(ahoraMs) && ahoraMs - finMs < c.demoraMinutos * 60_000) {
        return { turno_id: turnoId, estado: 'omitido', motivo: 'demora_pendiente' };
      }
    }

    const ref = dedupeClave(turnoId);
    const envio = enviarSolicitudResenaSimulada({
      turnoId,
      pacienteId: turno.paciente_id,
      canal: c.canalPredeterminado,
      referenciaOpaca: ref,
    });
    const ventanaHasta = new Date(
      new Date(ahoraIso).getTime() + c.ventanaDedupeHoras * 3600_000,
    ).toISOString();
    const row = this.repo.registrar({
      turno_id: turnoId,
      paciente_id: turno.paciente_id,
      canal: envio.canal,
      link_ref: 'configurada',
      estado: 'enviado_simulado',
      motivo_omision: null,
      dedupe_clave: ref,
      ventana_hasta: ventanaHasta,
      detalle_json: JSON.stringify({ canal: envio.canal, modo: 'simulado' }),
    });
    return {
      turno_id: turnoId,
      estado: 'enviado_simulado',
      solicitud_id: row.id,
      canal: row.canal,
    };
  }

  listarSolicitudes(limite?: number) {
    const max = Math.max(1, Math.min(limite ?? 100, this.solicitudResena.maxSolicitudesPorLote));
    return { solicitudes: this.repo.listar(max).map(aDto) };
  }

  obtenerSolicitud(id: string) {
    const row = this.repo.obtener(id);
    if (!row) throw new AppError({ status: 404, code: 'not_found', message: 'recurso no encontrado' });
    return aDto(row);
  }
}

/** Best-effort post-commit: nunca revierte el estado del turno ni lanza al llamador. R3: solo IDs opacos. */
export function solicitarResenaSeguro(
  db: DatabaseSync,
  config: Pick<AppConfig, 'solicitudResena'> | SolicitudResenaConfig,
  turnoId: string,
  ahoraIso?: string,
): void {
  try {
    const svc = new SolicitudResenaService(db, config);
    svc.procesarSolicitudParaTurnoAtendido(turnoId, ahoraIso);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`solicitud_resena fallo turno=${turnoId} error=${nombreDeError(err)}`);
  }
}
