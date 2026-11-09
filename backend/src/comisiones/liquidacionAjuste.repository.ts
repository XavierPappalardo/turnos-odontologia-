/**
 * Repositorio de ajustes compensatorios de comisiones (C-13, tasks 3.2; R8).
 * Ciclo `reservado → consumido` (D12): la reserva exclusiva queda garantizada
 * a nivel BD por el índice parcial `(item_origen_id) WHERE deleted_at IS NULL
 * AND estado_ajuste = 'reservado'` — un ajuste jamás pertenece a dos
 * borradores activos; las filas `consumido` NO bloquean el arrastre residual.
 * Absorción in-order determinista (D12): el ORDEN lo impone el servicio en la
 * transacción de confirmación (`pago.anulado_en ASC, pago_id ASC`); este
 * repositorio solo ejecuta asignaciones por fila (`consumir`).
 */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { BaseRepository, nowIsoUtc, softDeleteStamp } from '../shared/repository.js';
import type { TipoAjusteComision } from '../shared/types.js';

export interface AjusteComisionRow {
  id: string;
  liquidacion_id: string;
  /** Ítem CONFIRMADO de origen (la comisión original a compensar). */
  item_origen_id: string;
  /** Pago cuya anulación (o arrastre) motivó el ajuste. */
  pago_id: string;
  tipo_ajuste: TipoAjusteComision;
  /** Magnitud declarada: comisión original o saldo residual (entero > 0). */
  monto_ajuste_centavos: number;
  monto_compensado_centavos: number;
  estado_ajuste: 'reservado' | 'consumido';
  /** Sello de absorción; NULL mientras `reservado` (CHECK DDL). */
  compensado_en: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Anulación pendiente detectada (D12): ítem confirmado cuyo pago quedó anulado y SIN reserva activa. */
export interface AnulacionPendienteRow {
  item_origen_id: string;
  pago_id: string;
  monto_comision_original_centavos: number;
  anulado_en: string | null;
}

/** Saldo residual de absorciones ya realizadas (D12/P1): base del arrastre. */
export interface SaldoArrastreRow {
  item_origen_id: string;
  pago_id: string;
  resto_centavos: number;
  primer_anulado_en: string | null;
}

export class LiquidacionAjusteRepository extends BaseRepository<AjusteComisionRow> {
  constructor(db: DatabaseSync) {
    super(db, 'liquidacion_comision_ajuste');
  }

  /**
   * Inserta fila `estado_ajuste = 'reservado'` (monto_compensado 0,
   * `compensado_en` NULL). Corre DENTRO de la tx del servicio; si otro
   * borrador activo ya reservó el mismo `item_origen_id`, el índice parcial
   * aborta (violación UNIQUE → el servicio responde 409 vía fingerprint).
   */
  insertarReservado(
    row: Omit<
      AjusteComisionRow,
      | 'monto_compensado_centavos'
      | 'estado_ajuste'
      | 'compensado_en'
      | 'created_at'
      | 'updated_at'
      | 'deleted_at'
    >,
  ): void {
    const ahora = nowIsoUtc();
    this.db
      .prepare(
        `INSERT INTO liquidacion_comision_ajuste (
          id, liquidacion_id, item_origen_id, pago_id, tipo_ajuste,
          monto_ajuste_centavos, monto_compensado_centavos, estado_ajuste,
          compensado_en, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 'reservado', NULL, ?, ?, NULL)`,
      )
      .run(
        row.id,
        row.liquidacion_id,
        row.item_origen_id,
        row.pago_id,
        row.tipo_ajuste,
        row.monto_ajuste_centavos,
        ahora,
        ahora,
      );
  }

  listarPorLiquidacion(liquidacionId: string): AjusteComisionRow[] {
    return this.db
      .prepare(
        `SELECT * FROM liquidacion_comision_ajuste
          WHERE liquidacion_id = ? AND deleted_at IS NULL
          ORDER BY created_at ASC, id ASC`,
      )
      .all(liquidacionId) as unknown as AjusteComisionRow[];
  }

  listarReservadosPorLiquidacion(
    liquidacionId: string,
  ): AjusteComisionRow[] {
    return this.db
      .prepare(
        `SELECT * FROM liquidacion_comision_ajuste
          WHERE liquidacion_id = ? AND estado_ajuste = 'reservado' AND deleted_at IS NULL
          ORDER BY created_at ASC, id ASC`,
      )
      .all(liquidacionId) as unknown as AjusteComisionRow[];
  }

  /** Σ de ajustes reservados del host (monto_ajustes_centavos del borrador). */
  sumarReservadosPorLiquidacion(liquidacionId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(monto_ajuste_centavos), 0) AS total
            FROM liquidacion_comision_ajuste
          WHERE liquidacion_id = ? AND estado_ajuste = 'reservado' AND deleted_at IS NULL`,
      )
      .get(liquidacionId) as { total: number };
    return row.total;
  }

  /**
   * Liberación de la reserva: baja lógica de TODAS las filas activas de la
   * cabecera (solo tiene sentido para borradores: las filas del borrador son
   * `reservado`). Hace que la reserva quede pendiente para la próxima
   * generación. Corre en la misma tx del servicio.
   */
  liberarPorLiquidacion(liquidacionId: string): number {
    const stamp = softDeleteStamp();
    const result = this.db
      .prepare(
        `UPDATE liquidacion_comision_ajuste
            SET deleted_at = ?, updated_at = ?
          WHERE liquidacion_id = ? AND deleted_at IS NULL`,
      )
      .run(stamp.deleted_at, nowIsoUtc(), liquidacionId);
    return Number(result.changes);
  }

  /**
   * Consumo/absorción parcial (confirmación, D12): fija `estado='consumido'`,
   * `monto_compensado` y `compensado_en` por fila. `false` si la fila no está
   * `reservado` (ya consumida o inexistente). El CHECK DDL rechaza
   * `monto_compensado > monto_ajuste` o compensaciones de filas borradas.
   */
  consumir(
    id: string,
    args: { montoCompensado: number; compensadoEn: string },
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE liquidacion_comision_ajuste
            SET estado_ajuste = 'consumido',
                monto_compensado_centavos = ?,
                compensado_en = ?,
                updated_at = ?
          WHERE id = ? AND estado_ajuste = 'reservado' AND deleted_at IS NULL`,
      )
      .run(
        args.montoCompensado,
        args.compensadoEn,
        nowIsoUtc(),
        id,
      );
    return result.changes === 1;
  }

  /**
   * Detección (a) de pendientes (D12): comisiones de liquidaciones CONFIRMADAS
   * del profesional cuyo pago quedó `anulado`, SIN ninguna fila de ajuste
   * vigente (`reservado` o `consumido`: una fila consumida ya tiene
   * trayectoria de compensación — su resto lo reporta la detección (b), no
   * aquí, para no duplicar el conteo D12). La reserva LIBERADA (deleted_at)
   * vuelve a reportar el pendiente (P2). Orden determinista
   * `pago.anulado_en ASC, pago_id ASC` (absorción in-order, D12).
   *
   * `excluirLiquidacionId` (D13/P2): excluye del LEFT JOIN las filas de ajuste
   * de ESA cabecera para que una re-derivación intra-tx que ya posee reservas
   * propias (regeneración / confirmación) vuelva a listar sus pendientes y
   * derive el fingerprint que su propia generación almacenó. `undefined`
   * conserva el comportamiento original (todas las reservas descalifican).
   */
  listarAnulacionesSinReserva(
    profesionalId: string,
    excluirLiquidacionId?: string,
  ): AnulacionPendienteRow[] {
    const excluir = excluirLiquidacionId ?? null;
    return this.db
      .prepare(
        `SELECT i.id AS item_origen_id,
                i.pago_id,
                i.monto_comision_centavos AS monto_comision_original_centavos,
                p.anulado_en
           FROM liquidacion_comision_item i
           JOIN liquidacion_comision l ON l.id = i.liquidacion_id AND l.deleted_at IS NULL
           JOIN pago p ON p.id = i.pago_id
           LEFT JOIN liquidacion_comision_ajuste r
             ON r.item_origen_id = i.id
            AND r.deleted_at IS NULL
            AND (? IS NULL OR r.liquidacion_id <> ?)
          WHERE l.profesional_id = ? AND l.estado = 'confirmada'
            AND i.deleted_at IS NULL
            AND p.estado = 'anulado'
            AND r.id IS NULL
          ORDER BY p.anulado_en ASC, i.pago_id ASC`,
      )
      .all(excluir, excluir, profesionalId) as unknown as AnulacionPendienteRow[];
  }

  /**
   * Detección (b) de pendientes (D12/P1): saldo PENDIENTE > 0 de las filas
   * `consumido` agrupado por `item_origen_id`: `MAX(monto_ajuste) −
   * SUM(monto_compensado)` — el máximo es la comisión original de la cadena
   * (cada fila `saldo_arrastre` hereda un monto ≤ a su origen, snapshot) y
   * `SUM(monto_compensado)` es lo absorbido por TODA la cadena. Sumar
   * `monto_ajuste − monto_compensado` fila a fila contaría el propio monto de
   * la fila `saldo_arrastre` como pendiente NUEVO: la cadena jamás se saldaba
   * y el arrastre se re-listaría indefinidamente tras cada absorción (P2/P1:
   * la absorción reduce el saldo). Base del `saldo_arrastre` con la misma
   * reserva exclusiva; `deleted_at` de las cabeceras de origen respetado.
   */
  listarSaldosArrastre(profesionalId: string): SaldoArrastreRow[] {
    return this.db
      .prepare(
        `SELECT r.item_origen_id,
                r.pago_id,
                MAX(r.monto_ajuste_centavos) - SUM(r.monto_compensado_centavos) AS resto_centavos,
                MIN(p.anulado_en) AS primer_anulado_en
           FROM liquidacion_comision_ajuste r
           JOIN liquidacion_comision l ON l.id = r.liquidacion_id AND l.deleted_at IS NULL
           JOIN pago p ON p.id = r.pago_id
          WHERE l.profesional_id = ? AND r.estado_ajuste = 'consumido' AND r.deleted_at IS NULL
          GROUP BY r.item_origen_id
         HAVING resto_centavos > 0
          ORDER BY primer_anulado_en ASC, r.pago_id ASC`,
      )
      .all(profesionalId) as unknown as SaldoArrastreRow[];
  }
}
