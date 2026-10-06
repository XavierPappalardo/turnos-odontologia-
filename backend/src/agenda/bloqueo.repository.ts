/**
 * BloqueoRepository: lector de solo lectura (el CRUD pertenece a C-08).
 * NULL en profesional_id/sillon_id = global (design D2).
 */
import type { DatabaseSync } from 'node:sqlite';
import { BaseRepository } from '../shared/repository.js';
import type { ProfesionalId, SillonId } from '../shared/types.js';

export interface BloqueoRow {
  id: string;
  profesional_id: string | null;
  sillon_id: string | null;
  inicio: string;
  fin: string;
  motivo: string | null;
  created_at: string;
  updated_at: string;
}

export class BloqueoRepository extends BaseRepository<BloqueoRow> {
  constructor(db: DatabaseSync) {
    super(db, 'bloqueo');
  }

  existeBloqueoAplicable(
    profesionalId: ProfesionalId,
    sillonId: SillonId,
    nuevoInicio: string,
    nuevoFin: string,
  ): boolean {
    const stmt = this.db.prepare(
      `SELECT 1 FROM bloqueo
        WHERE (profesional_id IS NULL OR profesional_id = ?)
          AND (sillon_id IS NULL OR sillon_id = ?)
          AND inicio < ?
          AND fin > ?
        LIMIT 1`,
    );
    return (
      stmt.get(profesionalId, sillonId, nuevoFin, nuevoInicio) !== undefined
    );
  }
}
