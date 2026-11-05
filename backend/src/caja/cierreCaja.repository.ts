/**
 * Repositorio de cierres de caja (C-11, tasks 2.2, design D4).
 * Snapshot UNIQUE por fecha contable; insert + consultas únicamente:
 * la clase no expone update/softDelete de negocio y los triggers de la
 * migración 010 abortan cualquier UPDATE/DELETE en base (inmutabilidad).
 * Todo el SQL vive aquí (R8).
 */
import type { DatabaseSync } from 'node:sqlite';
import { BaseRepository } from '../shared/repository.js';
import type { CierreCajaId } from '../shared/types.js';

export interface CierreCajaRow {
  readonly id: string;
  readonly fecha: string;
  readonly zona_horaria: string;
  readonly total_efectivo_centavos: number;
  readonly total_tarjeta_centavos: number;
  readonly total_transferencia_centavos: number;
  readonly total_mercadopago_centavos: number;
  readonly total_obra_social_centavos: number;
  readonly anulaciones_cantidad: number;
  readonly anulaciones_centavos: number;
  readonly actor_usuario_id: string;
  readonly cerrado_en: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface RegistrarCierreInput {
  id: CierreCajaId;
  fecha: string;
  zonaHoraria: string;
  totalEfectivoCentavos: number;
  totalTarjetaCentavos: number;
  totalTransferenciaCentavos: number;
  totalMercadopagoCentavos: number;
  totalObraSocialCentavos: number;
  anulacionesCantidad: number;
  anulacionesCentavos: number;
  actorUsuarioId: string;
  cerradoEn: string;
}

export class CierreCajaRepository extends BaseRepository<CierreCajaRow> {
  constructor(db: DatabaseSync) {
    super(db, 'cierre_caja');
  }

  /** Inserta el snapshot; la unicidad UNIQUE(fecha) queda protegida en base. */
  insertar(input: RegistrarCierreInput): void {
    this.insert({
      id: input.id as string,
      fecha: input.fecha,
      zona_horaria: input.zonaHoraria,
      total_efectivo_centavos: input.totalEfectivoCentavos,
      total_tarjeta_centavos: input.totalTarjetaCentavos,
      total_transferencia_centavos: input.totalTransferenciaCentavos,
      total_mercadopago_centavos: input.totalMercadopagoCentavos,
      total_obra_social_centavos: input.totalObraSocialCentavos,
      anulaciones_cantidad: input.anulacionesCantidad,
      anulaciones_centavos: input.anulacionesCentavos,
      actor_usuario_id: input.actorUsuarioId,
      cerrado_en: input.cerradoEn,
    });
  }

  /** ¿Existe otro cierre con esa fecha contable? (check-then-insert en UnitOfWork). */
  existeCierreFecha(fecha: string): boolean {
    const fila = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM cierre_caja WHERE fecha = ?`,
      )
      .get(fecha) as { n: number };
    return fila.n > 0;
  }

  buscarPorFecha(fecha: string): CierreCajaRow | undefined {
    return this.db
      .prepare(`SELECT * FROM cierre_caja WHERE fecha = ?`)
      .get(fecha) as CierreCajaRow | undefined;
  }

  /** Historial de cierres: fechas cerradas, más reciente primero (spec cierre-diario). */
  listarCierres(): CierreCajaRow[] {
    return this.db
      .prepare(
        `SELECT * FROM cierre_caja ORDER BY fecha DESC`,
      )
      .all() as unknown as CierreCajaRow[];
  }
}
