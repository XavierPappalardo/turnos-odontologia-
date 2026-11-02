/**
 * PacienteRepository (C-09, task 2.5).
 * `findVigente`: paciente activo y no dado de baja.
 * `actualizarDatosClinicos`: actualiza `fecha_nacimiento`/`alergias`
 * respetando `deleted_at IS NULL` y `updated_at`.
 */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { BaseRepository } from '../shared/repository.js';
import type { PacienteRow } from './models.js';

export type PacienteDatosClinicos = Partial<
  Pick<PacienteRow, 'fecha_nacimiento' | 'alergias'>
>;

export class PacienteRepository extends BaseRepository<PacienteRow> {
  constructor(db: DatabaseSync) {
    super(db, 'paciente');
  }

  findVigente(id: string): PacienteRow | undefined {
    const stmt = this.db.prepare(
      `SELECT * FROM paciente WHERE id = ? AND activo = 1 AND deleted_at IS NULL`,
    );
    return stmt.get(id) as PacienteRow | undefined;
  }

  actualizarDatosClinicos(
    id: string,
    datos: PacienteDatosClinicos,
  ): boolean {
    const cols: string[] = [];
    const values: unknown[] = [];
    for (const [key, val] of Object.entries(datos)) {
      const snake = key === 'fecha_nacimiento' ? 'fecha_nacimiento' : 'alergias';
      const normalized =
        snake === 'alergias' && typeof val === 'string' && val.trim() === ''
          ? null
          : val;
      cols.push(`${snake} = ?`);
      values.push(normalized);
    }
    if (cols.length === 0) return false;
    values.push(new Date().toISOString(), id);
    const result = this.db
      .prepare(
        `UPDATE paciente SET ${cols.join(', ')}, updated_at = ? WHERE id = ? AND activo = 1 AND deleted_at IS NULL`,
      )
      .run(...(values as SQLInputValue[]));
    return result.changes === 1;
  }
}
