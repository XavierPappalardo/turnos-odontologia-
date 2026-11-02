/**
 * C-09 task 5.2: AccesoHcService.
 * `esTitular`: un paciente es "suyo" si tiene al menos un turno con el
 * profesional en cualquier estado (incluyendo cancelado).
 * Diseño D4: consulta de titularidad derivada de turnos.
 */
import type { DatabaseSync } from 'node:sqlite';

export class AccesoHcService {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  esTitular(pacienteId: string, profesionalId: string): boolean {
    const stmt = this.db.prepare(
      `SELECT 1 FROM turno
       WHERE paciente_id = ? AND profesional_id = ? AND deleted_at IS NULL
       LIMIT 1`,
    );
    return stmt.get(pacienteId, profesionalId) !== undefined;
  }
}
