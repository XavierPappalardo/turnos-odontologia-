/**
 * Repositorio append-only de eventos de liquidación de comisiones
 * (C-13, tasks 3.2; R8): `generada` / `confirmada` con actor y sello de
 * negocio. Extiende `AppendOnlyRepository` — insert sella `created_at` y
 * `update`/`softDelete` lanzan `EventoInmutableError` (tercera defensa: los
 * triggers insert-only de 012 abortan cualquier UPDATE/DELETE SQL).
 */
import type { DatabaseSync } from 'node:sqlite';
import { AppendOnlyRepository } from '../shared/repository.js';
import type { EventoComision } from '../shared/types.js';

export interface EventoLiquidacionComisionRow {
  id: string;
  liquidacion_id: string;
  evento: EventoComision;
  actor_usuario_id: string;
  /** Momento del evento de negocio. */
  ocurrido_en: string;
  /** Sello de inserción (contrato AppendOnlyRepository). */
  created_at: string;
}

export class LiquidacionEventoRepository extends AppendOnlyRepository<EventoLiquidacionComisionRow> {
  constructor(db: DatabaseSync) {
    super(db, 'liquidacion_comision_evento');
  }

  listarPorLiquidacion(
    liquidacionId: string,
  ): EventoLiquidacionComisionRow[] {
    return this.db
      .prepare(
        `SELECT * FROM liquidacion_comision_evento
          WHERE liquidacion_id = ?
          ORDER BY ocurrido_en ASC, created_at ASC`,
      )
      .all(liquidacionId) as unknown as EventoLiquidacionComisionRow[];
  }
}
