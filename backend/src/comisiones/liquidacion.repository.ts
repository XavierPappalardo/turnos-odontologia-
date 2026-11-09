/**
 * Repositorio de cabeceras de liquidación de comisiones (C-13, tasks 3.2; R8).
 * Patrón C-12 (`liquidacion.repository.ts`): cabecera por profesional + período
 * con UNIQUE activa (`com_liquidacion_periodo_activa`), máquina lineal
 * `borrador → confirmada` (D5) y guard por estado en cada mutación.
 * La confirmación es un único UPDATE atómico (`confirmar`): el CHECK CASE de
 * `saldo_compensacion_centavos` valida el par (estado, saldo) dentro de la
 * misma sentencia. `actualizarMontos` es solo para borradores (regeneración).
 */
import type { DatabaseSync } from 'node:sqlite';
import { BaseRepository, nowIsoUtc } from '../shared/repository.js';
import type { LiquidacionComisionEstado } from '../shared/types.js';

export interface LiquidacionComisionRow {
  id: string;
  profesional_id: string;
  desde: string;
  hasta: string;
  estado: LiquidacionComisionEstado;
  monto_items_centavos: number;
  monto_ajustes_centavos: number;
  /** Neto = items − ajustes (identidad CHECK en DDL; puede ser < 0 solo por ajustes, D9). */
  monto_total_centavos: number;
  /** 0 en borrador; max(0, ajustes − items) en confirmada (CHECK CASE en DDL, D12). */
  saldo_compensacion_centavos: number;
  /** SHA-256 del cálculo al generar/regenerar (D13). */
  fingerprint: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MontosLiquidacion {
  monto_items_centavos: number;
  monto_ajustes_centavos: number;
  monto_total_centavos: number;
  saldo_compensacion_centavos: number;
}

export class LiquidacionComisionRepository extends BaseRepository<LiquidacionComisionRow> {
  constructor(db: DatabaseSync) {
    super(db, 'liquidacion_comision');
  }

  buscarPorIdVigente(id: string): LiquidacionComisionRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM liquidacion_comision
          WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(id) as LiquidacionComisionRow | undefined;
  }

  /** Guard `periodo_ya_liquidado` del servicio: máx. una liquidación vigente por período exacto. */
  buscarPorProfesionalYPeriodoVigente(
    profesionalId: string,
    desde: string,
    hasta: string,
  ): LiquidacionComisionRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM liquidacion_comision
          WHERE profesional_id = ? AND desde = ? AND hasta = ? AND deleted_at IS NULL`,
      )
      .get(profesionalId, desde, hasta) as
      LiquidacionComisionRow | undefined;
  }

  /** Vigentes (todas para `administracion`; Q6 saca al borrador del portal profesional). */
  listarVigentes(profesionalId?: string): LiquidacionComisionRow[] {
    if (profesionalId) {
      return this.db
        .prepare(
          `SELECT * FROM liquidacion_comision
            WHERE profesional_id = ? AND deleted_at IS NULL
            ORDER BY desde DESC, created_at DESC`,
        )
        .all(profesionalId) as unknown as LiquidacionComisionRow[];
    }
    return this.db
      .prepare(
        `SELECT * FROM liquidacion_comision
          WHERE deleted_at IS NULL
          ORDER BY desde DESC, created_at DESC`,
      )
      .all() as unknown as LiquidacionComisionRow[];
  }

  /** Portal del profesional (Q6 ratificada): SOLO confirmadas, scoping por cabecera. */
  listarConfirmadasPorProfesional(
    profesionalId: string,
  ): LiquidacionComisionRow[] {
    return this.db
      .prepare(
        `SELECT * FROM liquidacion_comision
          WHERE profesional_id = ? AND estado = 'confirmada' AND deleted_at IS NULL
          ORDER BY desde DESC, created_at DESC`,
      )
      .all(profesionalId) as unknown as LiquidacionComisionRow[];
  }

  /**
   * Transición lineal `borrador → confirmada` (D5): idempotente de estado
   * (una segunda llamada sobre `confirmada` devuelve false). Corre dentro de
   * la transacción del servicio (BEGIN IMMEDIATE, R12).
   */
  cambiarEstado(id: string, nuevoEstado: 'confirmada'): boolean {
    if (nuevoEstado !== 'confirmada') {
      throw new Error(
        'transición no soportada (D5: única `borrador → confirmada`)',
      );
    }
    const result = this.db
      .prepare(
        `UPDATE liquidacion_comision
            SET estado = 'confirmada', updated_at = ?
          WHERE id = ? AND deleted_at IS NULL AND estado = 'borrador'`,
      )
      .run(nowIsoUtc(), id);
    return result.changes === 1;
  }

  /** Actualización de montos de la cabecera — SOLO borrador (regeneración; D4). */
  actualizarMontos(id: string, montos: MontosLiquidacion): boolean {
    const result = this.db
      .prepare(
        `UPDATE liquidacion_comision
            SET monto_items_centavos = ?, monto_ajustes_centavos = ?,
                monto_total_centavos = ?, saldo_compensacion_centavos = ?,
                updated_at = ?
          WHERE id = ? AND deleted_at IS NULL AND estado = 'borrador'`,
      )
      .run(
        montos.monto_items_centavos,
        montos.monto_ajustes_centavos,
        montos.monto_total_centavos,
        montos.saldo_compensacion_centavos,
        nowIsoUtc(),
        id,
      );
    return result.changes === 1;
  }

  /**
   * Confirmación atómica (patrón F1 de C-12 refinado por D13): estado +
   * fingerprint + montos exactos en un solo UPDATE condicionado a
   * `estado = 'borrador'`. El CHECK CASE de la DDL valida `saldo` contra el
   * estado final en la misma sentencia; false si la cabecera no es
   * `borrador` (el servicio traduce a `estado_invalido`).
   */
  confirmar(
    id: string,
    args: {
      fingerprint: string;
      montos: MontosLiquidacion;
    },
  ): boolean {
    const ahora = nowIsoUtc();
    const result = this.db
      .prepare(
        `UPDATE liquidacion_comision
            SET estado = 'confirmada', fingerprint = ?,
                monto_items_centavos = ?, monto_ajustes_centavos = ?,
                monto_total_centavos = ?, saldo_compensacion_centavos = ?,
                updated_at = ?
          WHERE id = ? AND deleted_at IS NULL AND estado = 'borrador'`,
      )
      .run(
        args.fingerprint,
        args.montos.monto_items_centavos,
        args.montos.monto_ajustes_centavos,
        args.montos.monto_total_centavos,
        args.montos.saldo_compensacion_centavos,
        ahora,
        id,
      );
    return result.changes === 1;
  }

  /** Fingerprint del borrador al generar/regenerar (D13); `confirmada` es inmutable. */
  actualizarFingerprint(id: string, fingerprint: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE liquidacion_comision
            SET fingerprint = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL AND estado = 'borrador'`,
      )
      .run(fingerprint, nowIsoUtc(), id);
    return result.changes === 1;
  }
}
