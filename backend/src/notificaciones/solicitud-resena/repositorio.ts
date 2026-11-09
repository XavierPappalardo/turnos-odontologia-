/**
 * Repositorio C-19 (R8): solicitudes de reseña y dedupe. Sin PHI.
 */
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { UnitOfWork } from '../../shared/repository.js';

export type EstadoSolicitudResena = 'enviado_simulado' | 'omitido' | 'fallido';

export interface SolicitudResenaRow {
  id: string;
  turno_id: string;
  paciente_id: string;
  canal: 'whatsapp' | 'email';
  link_ref: string;
  estado: EstadoSolicitudResena;
  motivo_omision: string | null;
  dedupe_clave: string;
  ventana_hasta: string | null;
  detalle_json: string;
  created_at: string;
  updated_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class SolicitudResenaRepository {
  constructor(private readonly db: DatabaseSync) {}

  existeParaTurno(turnoId: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 AS ok FROM solicitud_resena WHERE turno_id = ? LIMIT 1`)
      .get(turnoId) as { ok: number } | undefined;
    return row !== undefined;
  }

  obtenerPorTurno(turnoId: string): SolicitudResenaRow | undefined {
    return this.db
      .prepare(`SELECT * FROM solicitud_resena WHERE turno_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(turnoId) as SolicitudResenaRow | undefined;
  }

  registrar(input: Omit<SolicitudResenaRow, 'id' | 'created_at' | 'updated_at'>): SolicitudResenaRow {
    const uow = new UnitOfWork(this.db);
    return uow.runInTransaction(() => {
      const id = randomUUID();
      const ahora = nowIso();
      this.db
        .prepare(
          `INSERT INTO solicitud_resena (id,turno_id,paciente_id,canal,link_ref,estado,motivo_omision,dedupe_clave,ventana_hasta,detalle_json,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          input.turno_id,
          input.paciente_id,
          input.canal,
          input.link_ref,
          input.estado,
          input.motivo_omision ?? null,
          input.dedupe_clave,
          input.ventana_hasta ?? null,
          input.detalle_json,
          ahora,
          ahora,
        );
      return this.db
        .prepare(`SELECT * FROM solicitud_resena WHERE id = ?`)
        .get(id) as unknown as SolicitudResenaRow;
    });
  }

  listar(limite = 100): SolicitudResenaRow[] {
    return this.db
      .prepare(`SELECT * FROM solicitud_resena ORDER BY created_at DESC LIMIT ?`)
      .all(limite) as unknown as SolicitudResenaRow[];
  }

  obtener(id: string): SolicitudResenaRow | undefined {
    return this.db
      .prepare(`SELECT * FROM solicitud_resena WHERE id = ?`)
      .get(id) as SolicitudResenaRow | undefined;
  }
}
