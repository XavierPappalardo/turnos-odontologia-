/**
 * Repositorio de ítems de liquidación de comisiones (C-13, tasks 3.2; R8).
 * Cobrea snapshots inmutables por cobro (D4): `turno_id`, `fecha_contable`
 * (formato `YYYY-MM-DD`, mismo CHECK GLOB que `movimiento_caja` de 010),
 * `monto_cobro_centavos`, `pct_aplicado`, `regla_aplicada`,
 * `monto_comision_centavos`. La tabla NO tiene `updated_at` (snapshot de solo
 * inserción + soft delete para regeneración): `insert` sella solo
 * `created_at` — patrón idéntico a `obra_sociales/liquidacionItem.repository.ts`.
 * `UNIQUE (pago_id) WHERE deleted_at IS NULL` (`com_item_pago_unico`): un cobro
 * solo pertenece a una liquidación vigente (guard anti doble-comisión, D7).
 */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { BaseRepository, nowIsoUtc } from '../shared/repository.js';
import type { ReglaComisionAplicada } from '../shared/types.js';

export interface ItemLiquidacionComisionRow {
  id: string;
  liquidacion_id: string;
  pago_id: string;
  /** Snapshot del turno comisionado (turno del pago o `presupuesto.turno_id`; D2). */
  turno_id: string;
  /** Snapshot D4 de la fecha contable del cobro (`YYYY-MM-DD`). */
  fecha_contable: string;
  monto_cobro_centavos: number;
  pct_aplicado: number;
  regla_aplicada: ReglaComisionAplicada;
  monto_comision_centavos: number;
  created_at: string;
  deleted_at: string | null;
}

export interface NuevoItemSnapshot {
  id: string;
  liquidacion_id: string;
  pago_id: string;
  turno_id: string;
  fecha_contable: string;
  monto_cobro_centavos: number;
  pct_aplicado: number;
  regla_aplicada: ReglaComisionAplicada;
  monto_comision_centavos: number;
}

export class LiquidacionItemRepository extends BaseRepository<ItemLiquidacionComisionRow> {
  constructor(db: DatabaseSync) {
    super(db, 'liquidacion_comision_item');
  }

  /** Inserción del snapshot íntegro del cobro (sin `updated_at`; D4). */
  override insert(row: NuevoItemSnapshot): void {
    const full: Record<string, SQLInputValue> = {
      ...(row as unknown as Record<string, SQLInputValue>),
      created_at: nowIsoUtc(),
    };
    const cols = Object.keys(full);
    const placeholders = cols.map(() => '?').join(', ');
    const stmt = this.db.prepare(
      `INSERT INTO ${this.table} (${cols.join(', ')}) VALUES (${placeholders})`,
    );
    stmt.run(...cols.map((c) => full[c] as SQLInputValue));
  }

  listarPorLiquidacion(
    liquidacionId: string,
  ): ItemLiquidacionComisionRow[] {
    return this.db
      .prepare(
        `SELECT * FROM liquidacion_comision_item
          WHERE liquidacion_id = ? AND deleted_at IS NULL
          ORDER BY created_at ASC, id ASC`,
      )
      .all(liquidacionId) as unknown as ItemLiquidacionComisionRow[];
  }

  /**
   * Guard `cobro_ya_liquidado` del servicio: si el pago ya tiene ítem
   * vigente, pertenece a otra liquidación (la BD ya lo impide vía
   * `com_item_pago_unico`; el método habilita el mensaje de error).
   */
  buscarPorPagoIdVigente(pagoId: string): ItemLiquidacionComisionRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM liquidacion_comision_item
          WHERE pago_id = ? AND deleted_at IS NULL`,
      )
      .get(pagoId) as ItemLiquidacionComisionRow | undefined;
  }

  /**
   * Σ exacta de comisiones de los ítems vigentes (R2: entero). Usar DENTRO de
   * la transacción del servicio: el total de la cabecera nunca se calcula
   * desde lecturas fuera de ella (obs. auditoría F1/F6).
   */
  sumarVigentesPorLiquidacion(liquidacionId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(monto_comision_centavos), 0) AS total
            FROM liquidacion_comision_item
          WHERE liquidacion_id = ? AND deleted_at IS NULL`,
      )
      .get(liquidacionId) as { total: number };
    return row.total;
  }

  /**
   * Baja lógica en cascada de los ítems vigentes (regeneración / baja del
   * borrador). Sin `updated_at` (snapshot), no usa BaseRepository.softDelete.
   * Devuelve la cantidad dada de baja; corre dentro de la tx del servicio.
   */
  darDeBajaPorLiquidacion(liquidacionId: string): number {
    const result = this.db
      .prepare(
        `UPDATE liquidacion_comision_item
            SET deleted_at = ?
          WHERE liquidacion_id = ? AND deleted_at IS NULL`,
      )
      .run(nowIsoUtc(), liquidacionId);
    return Number(result.changes);
  }
}
