/** Repositorio de pagos (C-02, R2/R5/R8): montos siempre en centavos. */
import type { DatabaseSync } from 'node:sqlite';
import { BaseRepository } from '../shared/repository.js';
import type { PagoEstado, PagoMedio, PagoRow } from './models.js';

export interface NuevoPago {
  id: string;
  turnoId: string;
  montoCentavos: number;
  medio: PagoMedio;
  estado?: PagoEstado;
}

export class PagoRepository extends BaseRepository<PagoRow> {
  constructor(db: DatabaseSync) {
    super(db, 'pago');
  }

  crear(input: NuevoPago): void {
    if (!Number.isInteger(input.montoCentavos) || input.montoCentavos < 0) {
      throw new Error('monto_centavos debe ser un entero >= 0');
    }
    this.insert({
      id: input.id,
      turno_id: input.turnoId,
      monto_centavos: input.montoCentavos,
      moneda: 'ARS',
      medio: input.medio,
      estado: input.estado ?? 'pendiente',
      deleted_at: null,
    });
  }

  totalCobradoPorTurno(turnoId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(monto_centavos), 0) AS total
           FROM pago
          WHERE turno_id = ? AND estado = 'cobrado' AND deleted_at IS NULL`,
      )
      .get(turnoId) as { total: number };
    return row.total;
  }
}
