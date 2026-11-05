/**
 * Repositorio de ítems de liquidación de obra social (C-12, R8).
 * Copia snapshots de importes y porcentaje.
 * Tabla con created_at (sin updated_at por ser registros inmutables).
 */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { BaseRepository, nowIsoUtc } from '../shared/repository.js';

export interface LiquidacionItemRow {
  id: string;
  liquidacion_id: string;
  cobertura_id: string;
  turno_id: string;
  monto_cobertura_centavos: number;
  saldo_paciente_centavos: number;
  cobertura_pct: number;
  created_at: string;
  deleted_at: string | null;
}

export class LiquidacionItemRepository extends BaseRepository<LiquidacionItemRow> {
  constructor(db: DatabaseSync) {
    super(db, 'obra_social_liquidacion_item');
  }

  override insert(
    row: Omit<LiquidacionItemRow, 'created_at'> & { id: string },
  ): void {
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

  listarPorLiquidacion(liquidacionId: string): LiquidacionItemRow[] {
    return this.db
      .prepare(
        `SELECT * FROM obra_social_liquidacion_item
         WHERE liquidacion_id = ? AND deleted_at IS NULL
         ORDER BY created_at ASC`,
      )
      .all(liquidacionId) as unknown as LiquidacionItemRow[];
  }

  buscarPorTurnoIdVigente(turnoId: string): LiquidacionItemRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM obra_social_liquidacion_item
         WHERE turno_id = ? AND deleted_at IS NULL`,
      )
      .get(turnoId) as LiquidacionItemRow | undefined;
  }

  /**
   * Total derivado: suma EXACTA de `monto_cobertura_centavos` de los ítems
   * vigentes de una liquidación (usar DENTRO de la transacción del servicio:
   * el total de la cabecera nunca se calcula desde lecturas fuera de ella —
   * obs. auditoría F1/F6, R2).
   */
  sumarVigentesPorLiquidacion(liquidacionId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(monto_cobertura_centavos), 0) AS total
           FROM obra_social_liquidacion_item
          WHERE liquidacion_id = ? AND deleted_at IS NULL`,
      )
      .get(liquidacionId) as { total: number };
    return row.total;
  }

  /**
   * Baja lógica en cascade de los ítems vigentes de una liquidación (obs. 6.5).
   * La tabla no tiene `updated_at` (registros inmutables de snapshot), por eso
   * no se usa BaseRepository.softDelete. Devuelve la cantidad de ítems dados
   * de baja; corre DENTRO de la transacción del servicio (mismo UnitOfWork).
   */
  darDeBajaPorLiquidacion(liquidacionId: string): number {
    const result = this.db
      .prepare(
        `UPDATE obra_social_liquidacion_item
            SET deleted_at = ?
          WHERE liquidacion_id = ? AND deleted_at IS NULL`,
      )
      .run(nowIsoUtc(), liquidacionId);
    return Number(result.changes);
  }
}
