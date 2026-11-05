/**
 * Repositorio append-only para eventos de liquidación (C-12, R8, D2, D8).
 * Extiende AppendOnlyRepository: insert sella created_at; update/softDelete prohibidos.
 */
import type { DatabaseSync } from 'node:sqlite';
import { AppendOnlyRepository } from '../shared/repository.js';
import type { LiquidacionOsEvento } from '../shared/types.js';

export interface EventoLiquidacionOsRow {
  id: string;
  liquidacion_id: string;
  evento: LiquidacionOsEvento;
  actor_usuario_id: string;
  ocurrido_en: string;
  created_at: string;
}

export class LiquidacionEventoRepository extends AppendOnlyRepository<EventoLiquidacionOsRow> {
  constructor(db: DatabaseSync) {
    super(db, 'obra_social_liquidacion_evento');
  }

  listarPorLiquidacion(liquidacionId: string): EventoLiquidacionOsRow[] {
    return this.db
      .prepare(
        `SELECT * FROM obra_social_liquidacion_evento
         WHERE liquidacion_id = ?
         ORDER BY ocurrido_en ASC, created_at ASC`,
      )
      .all(liquidacionId) as unknown as EventoLiquidacionOsRow[];
  }
}
