/**
 * C-09 task 6.1: HistoriaClinicaRepository.
 * Tabla `hc_evento` (solo created_at, sin updated_at). Insert-only.
 * insert, listado por `ocurrido_en` e `id`, `findById`, `existeEnmiendaDe`,
 * `perteneceAPaciente`.
 */
import type { DatabaseSync } from 'node:sqlite';
import { AppendOnlyRepository } from '../shared/repository.js';

export interface HcEventoRow {
  id: string;
  paciente_id: string;
  turno_id: string | null;
  tipo: string;
  detalle: string;
  ocurrido_en: string;
  actor_usuario_id: string;
  profesional_id: string;
  enmienda_de: string | null;
  motivo_enmienda: string | null;
  created_at: string;
}

export interface HcEventoInput {
  id: string;
  paciente_id: string;
  turno_id: string | null;
  tipo: string;
  detalle: string;
  ocurrido_en: string;
  actor_usuario_id: string;
  profesional_id: string;
  enmienda_de?: string | null;
  motivo_enmienda?: string | null;
  created_at?: string;
}

export class HistoriaClinicaRepository extends AppendOnlyRepository<HcEventoRow> {
  constructor(db: DatabaseSync) {
    super(db, 'hc_evento');
  }

  insertar(input: HcEventoInput): void {
    this.insert({
      id: input.id,
      paciente_id: input.paciente_id,
      turno_id: input.turno_id,
      tipo: input.tipo,
      detalle: input.detalle,
      ocurrido_en: input.ocurrido_en,
      actor_usuario_id: input.actor_usuario_id,
      profesional_id: input.profesional_id,
      enmienda_de: input.enmienda_de ?? null,
      motivo_enmienda: input.motivo_enmienda ?? null,
    } as unknown as Omit<HcEventoRow, 'created_at' | 'updated_at'> & {
      id: string;
    });
  }

  findById(id: string): HcEventoRow | undefined {
    const stmt = this.db.prepare(`SELECT * FROM hc_evento WHERE id = ?`);
    return stmt.get(id) as HcEventoRow | undefined;
  }

  listarPorPaciente(pacienteId: string): HcEventoRow[] {
    const stmt = this.db.prepare(
      `SELECT * FROM hc_evento
       WHERE paciente_id = ?
       ORDER BY ocurrido_en ASC, id ASC`,
    );
    return stmt.all(pacienteId) as unknown as HcEventoRow[];
  }

  existeEnmiendaDe(eventoId: string): boolean {
    const stmt = this.db.prepare(
      `SELECT 1 FROM hc_evento WHERE enmienda_de = ? LIMIT 1`,
    );
    return stmt.get(eventoId) !== undefined;
  }

  perteneceAPaciente(eventoId: string, pacienteId: string): boolean {
    const stmt = this.db.prepare(
      `SELECT 1 FROM hc_evento WHERE id = ? AND paciente_id = ? LIMIT 1`,
    );
    return stmt.get(eventoId, pacienteId) !== undefined;
  }
}
