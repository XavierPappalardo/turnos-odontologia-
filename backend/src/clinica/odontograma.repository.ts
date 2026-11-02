/**
 * C-09 task 7.1: OdontogramaRepository.
 * Tabla `odontograma_evento` (solo created_at, sin updated_at). Insert-only.
 * insert, estado actual con ROW_NUMBER, historial por pieza, eventos enmendados excluidos.
 * Diseño D2: estado actual derivado por ventana, sin tabla de proyección.
 */
import type { DatabaseSync } from 'node:sqlite';
import { AppendOnlyRepository } from '../shared/repository.js';

export interface OdontogramaEventoRow {
  id: string;
  paciente_id: string;
  turno_id: string | null;
  pieza_fdi: number;
  superficie: string;
  hallazgo: string;
  ocurrido_en: string;
  actor_usuario_id: string;
  profesional_id: string;
  enmienda_de: string | null;
  motivo_enmienda: string | null;
  created_at: string;
}

export interface OdontogramaEventoInput {
  id: string;
  paciente_id: string;
  turno_id: string | null;
  pieza_fdi: number;
  superficie: string;
  hallazgo: string;
  ocurrido_en: string;
  actor_usuario_id: string;
  profesional_id: string;
  enmienda_de?: string | null;
  motivo_enmienda?: string | null;
  created_at?: string;
}

export interface EstadoActualRow {
  pieza_fdi: number;
  superficie: string;
  hallazgo: string;
  evento_id: string;
  ocurrido_en: string;
}

export class OdontogramaRepository extends AppendOnlyRepository<OdontogramaEventoRow> {
  constructor(db: DatabaseSync) {
    super(db, 'odontograma_evento');
  }

  insertar(input: OdontogramaEventoInput): void {
    this.insert({
      id: input.id,
      paciente_id: input.paciente_id,
      turno_id: input.turno_id,
      pieza_fdi: input.pieza_fdi,
      superficie: input.superficie,
      hallazgo: input.hallazgo,
      ocurrido_en: input.ocurrido_en,
      actor_usuario_id: input.actor_usuario_id,
      profesional_id: input.profesional_id,
      enmienda_de: input.enmienda_de ?? null,
      motivo_enmienda: input.motivo_enmienda ?? null,
    } as unknown as Omit<OdontogramaEventoRow, 'created_at' | 'updated_at'> & {
      id: string;
    });
  }

  findById(id: string): OdontogramaEventoRow | undefined {
    const stmt = this.db.prepare(`SELECT * FROM odontograma_evento WHERE id = ?`);
    return stmt.get(id) as OdontogramaEventoRow | undefined;
  }

  /** Estado actual por (pieza, superficie): último evento no enmendado. */
  estadoActual(pacienteId: string): EstadoActualRow[] {
    const stmt = this.db.prepare(
      `SELECT pieza_fdi, superficie, hallazgo, id AS evento_id, ocurrido_en
       FROM (
         SELECT e.*,
           ROW_NUMBER() OVER (
             PARTITION BY e.pieza_fdi, e.superficie
             ORDER BY e.ocurrido_en DESC, e.id DESC
           ) AS rn
         FROM odontograma_evento e
         WHERE e.paciente_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM odontograma_evento x WHERE x.enmienda_de = e.id
           )
       ) WHERE rn = 1
       ORDER BY pieza_fdi, superficie`,
    );
    return stmt.all(pacienteId) as unknown as EstadoActualRow[];
  }

  /** Historial de todos los eventos de una pieza, orden cronológico. */
  historialPorPieza(pacienteId: string, piezaFdi: number): OdontogramaEventoRow[] {
    const stmt = this.db.prepare(
      `SELECT * FROM odontograma_evento
       WHERE paciente_id = ? AND pieza_fdi = ?
       ORDER BY ocurrido_en ASC, id ASC`,
    );
    return stmt.all(pacienteId, piezaFdi) as unknown as OdontogramaEventoRow[];
  }

  existeEnmiendaDe(eventoId: string): boolean {
    const stmt = this.db.prepare(
      `SELECT 1 FROM odontograma_evento WHERE enmienda_de = ? LIMIT 1`,
    );
    return stmt.get(eventoId) !== undefined;
  }

  perteneceAPaciente(eventoId: string, pacienteId: string): boolean {
    const stmt = this.db.prepare(
      `SELECT 1 FROM odontograma_evento WHERE id = ? AND paciente_id = ? LIMIT 1`,
    );
    return stmt.get(eventoId, pacienteId) !== undefined;
  }
}
