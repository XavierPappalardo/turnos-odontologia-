/** Repositorio de obras sociales/planes (C-02, R8). */
import type { DatabaseSync } from 'node:sqlite';
import { BaseRepository } from '../shared/repository.js';
import type { ObraSocialPlanRow } from './models.js';

export class ObraSocialPlanRepository extends BaseRepository<ObraSocialPlanRow> {
  constructor(db: DatabaseSync) {
    super(db, 'obra_social_plan');
  }

  buscarPorPlan(
    obraSocial: string,
    plan: string,
  ): ObraSocialPlanRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM obra_social_plan
          WHERE obra_social = ? AND plan = ? AND deleted_at IS NULL`,
      )
      .get(obraSocial, plan) as ObraSocialPlanRow | undefined;
  }
}
