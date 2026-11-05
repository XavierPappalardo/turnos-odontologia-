/**
 * Repositorio de movimientos de caja (C-11, tasks 2.2/2.3, design D3).
 * Tabla append-only: acceso por `AppendOnlyRepository`; `update`/`softDelete`
 * lanzan `EventoInmutableError` y los triggers de la migración abortan
 * cualquier UPDATE/DELETE directo en la base. Todo el SQL vive aquí (R8).
 */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { AppendOnlyRepository } from '../shared/repository.js';
import type {
  CajaMovimientoId,
  MotivoAsignacionCaja,
} from '../shared/types.js';
import type { PagoId } from '../shared/types.js';

export interface CajaMovimientoRow {
  readonly id: string;
  readonly pago_id: string;
  readonly tipo: 'cobro' | 'anulacion';
  readonly monto_centavos: number;
  readonly moneda: 'ARS';
  readonly actor_usuario_id: string;
  /** Día local del evento (YYYY-MM-DD, zona IANA). */
  readonly fecha_contable: string;
  /** Día contable al que el movimiento queda asignado (snapshot/resumen). */
  readonly aplicado_en: string;
  readonly motivo_asignacion: MotivoAsignacionCaja | null;
  readonly created_at: string;
}

export interface InsertarMovimientoInput {
  id: CajaMovimientoId;
  pagoId: PagoId;
  tipo: 'cobro' | 'anulacion';
  montoCentavos: number;
  actorUsuarioId: string;
  fechaContable: string;
  /** Día de asignación; omitir para asignarlo a la propia `fechaContable`. */
  aplicadoEn?: string | undefined;
  motivoAsignacion?: MotivoAsignacionCaja | null | undefined;
}

/** Fila agregada por medio de pago para resúmenes/snapshots (cálculo con SUM exacto, D8). */
export interface TotalPorMedio {
  readonly medio: string;
  readonly total: number;
}

export class CajaMovimientoRepository extends AppendOnlyRepository<CajaMovimientoRow> {
  constructor(db: DatabaseSync) {
    super(db, 'movimiento_caja');
  }

  insertar(input: InsertarMovimientoInput): void {
    if (!Number.isSafeInteger(input.montoCentavos) || input.montoCentavos < 0) {
      throw new Error('monto_centavos debe ser un entero >= 0');
    }
    const tipo = input.tipo;
    if (tipo !== 'cobro' && tipo !== 'anulacion') {
      throw new Error(`tipo de movimiento inválido: ${tipo}`);
    }
    const row: Record<string, SQLInputValue> = {
      id: input.id as string,
      pago_id: input.pagoId as string,
      tipo,
      monto_centavos: input.montoCentavos,
      moneda: 'ARS',
      actor_usuario_id: input.actorUsuarioId,
      fecha_contable: input.fechaContable,
      aplicado_en: input.aplicadoEn ?? input.fechaContable,
      motivo_asignacion: input.motivoAsignacion ?? null,
    };
    this.insert(
      row as unknown as Omit<CajaMovimientoRow, 'created_at'> & {
        id: string;
      },
    );
  }

  /** Historial completo de un pago (orden temporal conservado). */
  listarPorPago(pagoId: string): CajaMovimientoRow[] {
    return this.db
      .prepare(
        `SELECT * FROM movimiento_caja
          WHERE pago_id = ?
          ORDER BY created_at ASC, id ASC`,
      )
      .all(pagoId) as unknown as CajaMovimientoRow[];
  }

  /** Movimientos asignados a una fecha contable (resumen/snapshot por `aplicado_en`). */
  listarPorFechaAplicada(fecha: string): CajaMovimientoRow[] {
    return this.db
      .prepare(
        `SELECT * FROM movimiento_caja
          WHERE aplicado_en = ?
          ORDER BY created_at ASC, id ASC`,
      )
      .all(fecha) as unknown as CajaMovimientoRow[];
  }

  /** Rango inclusivo de fechas de asignación (consultas por rango, C-11). */
  listarPorRangoAplicado(desde: string, hasta: string): CajaMovimientoRow[] {
    return this.db
      .prepare(
        `SELECT * FROM movimiento_caja
          WHERE aplicado_en >= ? AND aplicado_en <= ?
          ORDER BY aplicado_en ASC, created_at ASC, id ASC`,
      )
      .all(desde, hasta) as unknown as CajaMovimientoRow[];
  }

  /** Σ cobros por medio de pago sobre una fecha de asignación (R2/R8: SUM exacto). */
  totalesCobroPorMedio(fecha: string): TotalPorMedio[] {
    return this.db
      .prepare(
        `SELECT p.medio AS medio,
                COALESCE(SUM(m.monto_centavos), 0) AS total
           FROM movimiento_caja m
           JOIN pago p ON p.id = m.pago_id
          WHERE m.tipo = 'cobro' AND m.aplicado_en = ?
          GROUP BY p.medio
          ORDER BY p.medio ASC`,
      )
      .all(fecha) as unknown as TotalPorMedio[];
  }

  /** Σ anulaciones por medio de pago sobre una fecha de asignación. */
  totalesAnulacionPorMedio(fecha: string): TotalPorMedio[] {
    return this.db
      .prepare(
        `SELECT p.medio AS medio,
                COALESCE(SUM(m.monto_centavos), 0) AS total
           FROM movimiento_caja m
           JOIN pago p ON p.id = m.pago_id
          WHERE m.tipo = 'anulacion' AND m.aplicado_en = ?
          GROUP BY p.medio
          ORDER BY p.medio ASC`,
      )
      .all(fecha) as unknown as TotalPorMedio[];
  }
}
