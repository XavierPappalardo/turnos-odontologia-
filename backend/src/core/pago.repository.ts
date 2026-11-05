/**
 * Repositorio de pagos (C-02 → extendido por C-11, tasks 2.1/2.3).
 * Todo el SQL vive aquí (R8); montos siempre enteros en centavos (R2/R5).
 * La tabla `pago` quedó recompuesta por la migración 010: aplicación
 * (`turno_id`/`presupuesto_id` con CHECK obligatorio), `clave_idempotencia`
 * UNIQUE parcial, `referencia`, actor y datos de anulación.
 */
import type { DatabaseSync } from 'node:sqlite';
import { BaseRepository, nowIsoUtc } from '../shared/repository.js';
import type { PagoEstado, PagoMedio, PagoRow } from './models.js';

export interface NuevoPago {
  id: string;
  turnoId: string;
  montoCentavos: number;
  medio: PagoMedio;
  estado?: PagoEstado;
}

/** Medios de bolsillo: computan contra el saldo pendiente del concepto (C-11, D2). */
export const MEDIOS_BOLSILLO: readonly PagoMedio[] = [
  'efectivo',
  'tarjeta',
  'transferencia',
  'mercadopago',
];

export const MEDIOS_PAGO: readonly PagoMedio[] = [
  ...MEDIOS_BOLSILLO,
  'obra_social',
];

export interface CobroCaja {
  id: string;
  montoCentavos: number;
  medio: PagoMedio;
  estado: PagoEstado;
  turnoId: string | null;
  presupuestoId: string | null;
  claveIdempotencia?: string | null;
  referencia?: string | null;
  actorUsuarioId?: string | null;
}

const PLACEHOLDERS_MEDIOS_BOLSILLO = MEDIOS_BOLSILLO.map(() => '?').join(', ');

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
      presupuesto_id: null,
      monto_centavos: input.montoCentavos,
      moneda: 'ARS',
      medio: input.medio,
      estado: input.estado ?? 'pendiente',
      clave_idempotencia: null,
      referencia: null,
      actor_usuario_id: null,
      anulado_por_usuario_id: null,
      motivo_anulacion: null,
      anulado_en: null,
      deleted_at: null,
    });
  }

  /**
   * Alta de cobro de caja (C-11): valida monto entero > 0, medio del catálogo
   * y aplicación obligatoria (turno o presupuesto). Devuelve la fila creada.
   */
  cobrar(input: CobroCaja): PagoRow {
    if (!Number.isSafeInteger(input.montoCentavos) || input.montoCentavos <= 0) {
      throw new Error('monto_centavos debe ser un entero > 0');
    }
    if (!(MEDIOS_PAGO as readonly string[]).includes(input.medio)) {
      throw new Error(`medio inválido: ${input.medio}`);
    }
    const tieneAplicacion = input.turnoId !== null || input.presupuestoId !== null;
    if (!tieneAplicacion) {
      throw new Error('todo cobro requiere turno_id o presupuesto_id');
    }
    this.insert({
      id: input.id,
      turno_id: input.turnoId,
      presupuesto_id: input.presupuestoId,
      monto_centavos: input.montoCentavos,
      moneda: 'ARS',
      medio: input.medio,
      estado: input.estado,
      clave_idempotencia: input.claveIdempotencia ?? null,
      referencia: input.referencia ?? null,
      actor_usuario_id: input.actorUsuarioId ?? null,
      anulado_por_usuario_id: null,
      motivo_anulacion: null,
      anulado_en: null,
      deleted_at: null,
    });
    return this.findById(input.id) as PagoRow;
  }

  /** Transición pendiente→cobrado (idempotente por estado, C-11). */
  marcarCobrado(id: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE pago
            SET estado = 'cobrado', updated_at = ?
          WHERE id = ? AND estado = 'pendiente' AND deleted_at IS NULL`,
      )
      .run(nowIsoUtc(), id);
    return result.changes === 1;
  }

  /** Transición cobrado→anulado con trazabilidad (C-11); sólo si estaba cobrado. */
  anular(
    id: string,
    args: { anuladoPorUsuarioId: string; motivo: string },
  ): boolean {
    const ahora = nowIsoUtc();
    const result = this.db
      .prepare(
        `UPDATE pago
            SET estado = 'anulado',
                anulado_por_usuario_id = ?,
                motivo_anulacion = ?,
                anulado_en = ?,
                updated_at = ?
          WHERE id = ? AND estado = 'cobrado' AND deleted_at IS NULL`,
      )
      .run(
        args.anuladoPorUsuarioId,
        args.motivo,
        ahora,
        ahora,
        id,
      );
    return result.changes === 1;
  }

  /** Busca por clave de idempotencia (toda la vida del pago; el servicio compara payload). */
  buscarPorClaveIdempotencia(clave: string): PagoRow | undefined {
    return this.db
      .prepare(`SELECT * FROM pago WHERE clave_idempotencia = ?`)
      .get(clave) as PagoRow | undefined;
  }

  /** Historial de pagos de un turno, incluidos anulados (C-11, spec pagos). */
  listarPorTurno(turnoId: string): PagoRow[] {
    return this.db
      .prepare(
        `SELECT * FROM pago
          WHERE turno_id = ? AND deleted_at IS NULL
          ORDER BY created_at ASC, id ASC`,
      )
      .all(turnoId) as unknown as PagoRow[];
  }

  /** Historial de pagos aplicados a un concepto, incluidos anulados. */
  listarPorPresupuesto(presupuestoId: string): PagoRow[] {
    return this.db
      .prepare(
        `SELECT * FROM pago
          WHERE presupuesto_id = ? AND deleted_at IS NULL
          ORDER BY created_at ASC, id ASC`,
      )
      .all(presupuestoId) as unknown as PagoRow[];
  }

  /** Σ cobros de bolsillo vigentes aplicados a un concepto (descuenta deuda). */
  cobroBolsilloPorConcepto(presupuestoId: string): number {
    const fila = this.db
      .prepare(
        `SELECT COALESCE(SUM(monto_centavos), 0) AS total
           FROM pago
          WHERE presupuesto_id = ?
            AND medio IN (${PLACEHOLDERS_MEDIOS_BOLSILLO})
            AND estado = 'cobrado'
            AND deleted_at IS NULL`,
      )
      .get(
        presupuestoId,
        ...MEDIOS_BOLSILLO,
      ) as { total: number };
    return fila.total;
  }

  /** Σ cobros `obra_social` vigentes aplicados a un concepto (guard de cobertura restante). */
  cobroObraSocialPorConcepto(presupuestoId: string): number {
    const fila = this.db
      .prepare(
        `SELECT COALESCE(SUM(monto_centavos), 0) AS total
           FROM pago
          WHERE presupuesto_id = ?
            AND medio = 'obra_social'
            AND estado = 'cobrado'
            AND deleted_at IS NULL`,
      )
      .get(presupuestoId) as { total: number };
    return fila.total;
  }

  /** Σ cobros válidos de bolsillo de un turno (aplicados con turno + directos). */
  cobroBolsilloPorTurno(turnoId: string): number {
    const fila = this.db
      .prepare(
        `SELECT COALESCE(SUM(monto_centavos), 0) AS total
           FROM pago
          WHERE turno_id = ?
            AND medio <> 'obra_social'
            AND estado = 'cobrado'
            AND deleted_at IS NULL`,
      )
      .get(turnoId) as { total: number };
    return fila.total;
  }

  /** Σ cobros válidos `obra_social` de un turno (ingreso real de caja, separado). */
  cobroObraSocialPorTurno(turnoId: string): number {
    const fila = this.db
      .prepare(
        `SELECT COALESCE(SUM(monto_centavos), 0) AS total
           FROM pago
          WHERE turno_id = ?
            AND medio = 'obra_social'
            AND estado = 'cobrado'
            AND deleted_at IS NULL`,
      )
      .get(turnoId) as { total: number };
    return fila.total;
  }

  totalCobradoPorTurno(turnoId: string): number {
    const fila = this.db
      .prepare(
        `SELECT COALESCE(SUM(monto_centavos), 0) AS total
           FROM pago
          WHERE turno_id = ? AND estado = 'cobrado' AND deleted_at IS NULL`,
      )
      .get(turnoId) as { total: number };
    return fila.total;
  }
}
