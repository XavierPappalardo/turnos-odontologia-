/**
 * Repositorio de Prestaciones y Precios (C-15; R8).
 * Acceso exclusivo vía BaseRepository con consultas tipadas y validaciones monetarias en centavos.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { PrestacionRow } from '../core/models.js';
import { BaseRepository } from '../shared/repository.js';

export class PrestacionRepository extends BaseRepository<PrestacionRow> {
  constructor(db: DatabaseSync) {
    super(db, 'prestacion');
  }

  listarActivas(): PrestacionRow[] {
    const stmt = this.db.prepare(
      `SELECT * FROM prestacion WHERE activo = 1 ORDER BY nombre ASC`,
    );
    const rows = stmt.all() as unknown as PrestacionRow[];
    return rows.map((r) => ({
      ...r,
      precio_base_centavos: r.precio_base_centavos ?? 0,
    }));
  }

  obtenerPorId(id: string): PrestacionRow | undefined {
    const row = this.findById(id);
    if (!row) return undefined;
    return {
      ...row,
      precio_base_centavos: row.precio_base_centavos ?? 0,
    };
  }

  actualizarPrecio(
    id: string,
    precioBaseCentavos: number,
  ): PrestacionRow | undefined {
    if (
      typeof precioBaseCentavos !== 'number' ||
      !Number.isInteger(precioBaseCentavos) ||
      precioBaseCentavos < 0
    ) {
      throw new Error('precio_base_centavos debe ser un entero no negativo');
    }

    const existente = this.findById(id);
    if (!existente) {
      return undefined;
    }

    const updated = this.update(id, {
      precio_base_centavos: precioBaseCentavos,
    } as unknown as Partial<
      Omit<PrestacionRow, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>
    >);

    if (!updated) {
      return undefined;
    }

    return this.obtenerPorId(id);
  }
}
