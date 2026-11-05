/**
 * Repositorio de cabeceras de liquidación de obra social (C-12, R8).
 * Filtra coberturas elegibles por turno.inicio (Q3) y estado = 'atendido' (Q4).
 */
import type { DatabaseSync } from 'node:sqlite';
import { BaseRepository } from '../shared/repository.js';
import type { LiquidacionOsEstado } from '../shared/types.js';
import type { CoberturaTurnoRow } from './cobertura.repository.js';

export interface LiquidacionRow {
  id: string;
  obra_social_plan_id: string;
  desde: string;
  hasta: string;
  estado: LiquidacionOsEstado;
  monto_total_centavos: number;
  generada_por_usuario_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CoberturaElegibleRow extends CoberturaTurnoRow {
  turno_inicio: string;
}

export class LiquidacionRepository extends BaseRepository<LiquidacionRow> {
  constructor(db: DatabaseSync) {
    super(db, 'obra_social_liquidacion');
  }

  buscarPorIdVigente(id: string): LiquidacionRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM obra_social_liquidacion WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(id) as LiquidacionRow | undefined;
  }

  buscarPorPlanYPeriodoVigente(
    planId: string,
    desde: string,
    hasta: string,
  ): LiquidacionRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM obra_social_liquidacion
         WHERE obra_social_plan_id = ? AND desde = ? AND hasta = ? AND deleted_at IS NULL`,
      )
      .get(planId, desde, hasta) as LiquidacionRow | undefined;
  }

  listarVigentes(planId?: string): LiquidacionRow[] {
    if (planId) {
      return this.db
        .prepare(
          `SELECT * FROM obra_social_liquidacion
           WHERE obra_social_plan_id = ? AND deleted_at IS NULL
           ORDER BY desde DESC, created_at DESC`,
        )
        .all(planId) as unknown as LiquidacionRow[];
    }

    return this.db
      .prepare(
        `SELECT * FROM obra_social_liquidacion
         WHERE deleted_at IS NULL
         ORDER BY desde DESC, created_at DESC`,
      )
      .all() as unknown as LiquidacionRow[];
  }

  /**
   * Coberturas elegibles para liquidar:
   * - Pertenecen al plan
   * - No están eliminadas
   * - Turno en estado 'atendido' (Q4)
   * - Turno.inicio en [desde, hasta] inclusivo en UTC (Q3)
   * - No liquidadas previamente en liquidaciones vigentes
   */
  buscarCoberturasElegibles(
    planId: string,
    desdeUtc: string,
    hastaUtc: string,
  ): CoberturaElegibleRow[] {
    return this.db
      .prepare(
        `SELECT c.*, t.inicio AS turno_inicio
         FROM obra_social_cobertura_turno c
         JOIN turno t ON t.id = c.turno_id
         LEFT JOIN obra_social_liquidacion_item li ON li.turno_id = c.turno_id AND li.deleted_at IS NULL
         WHERE c.obra_social_plan_id = ?
           AND c.deleted_at IS NULL
           AND t.deleted_at IS NULL
           AND t.estado = 'atendido'
           AND t.inicio >= ?
           AND t.inicio <= ?
           AND li.id IS NULL
         ORDER BY t.inicio ASC`,
      )
      .all(planId, desdeUtc, hastaUtc) as unknown as CoberturaElegibleRow[];
  }
}
