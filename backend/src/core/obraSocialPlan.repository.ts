/**
 * Repositorio de obras sociales/planes (C-02, R8).
 * C-12 lo reutiliza y extiende (design D8, task 4.1): NO existe un repositorio
 * duplicado de planes en `src/obras-sociales/`; todo el SQL de planes vive aquí.
 */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { BaseRepository, nowIsoUtc } from '../shared/repository.js';
import type { ObraSocialPlanRow } from './models.js';

export interface ObraSocialPlanFiltros {
  obraSocial?: string | undefined;
  plan?: string | undefined;
}

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

  buscarPorIdVigente(id: string): ObraSocialPlanRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM obra_social_plan WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(id) as ObraSocialPlanRow | undefined;
  }

  /**
   * Listado de planes vigentes con filtros opcionales EXACTOS (spec
   * obras-sociales/planes). Solo columnas sin PHI: id/obra_social/plan/
   * cobertura_pct/activo.
   */
  listarVigentes(filtros: ObraSocialPlanFiltros = {}): ObraSocialPlanRow[] {
    let sql = `SELECT * FROM obra_social_plan WHERE deleted_at IS NULL`;
    const values: SQLInputValue[] = [];
    if (filtros.obraSocial !== undefined && filtros.obraSocial !== '') {
      sql += ` AND obra_social = ?`;
      values.push(filtros.obraSocial);
    }
    if (filtros.plan !== undefined && filtros.plan !== '') {
      sql += ` AND plan = ?`;
      values.push(filtros.plan);
    }
    sql += ` ORDER BY obra_social ASC, plan ASC`;
    return this.db.prepare(sql).all(...values) as unknown as ObraSocialPlanRow[];
  }

  /**
   * Baja lógica de plan (design Q5 default): sello `deleted_at` + `activo = 0`
   * en una sola escritura; `deleted_at IS NULL` evita re-sellar (spec: segunda
   * baja → 404).
   */
  darDeBaja(id: string): boolean {
    const now = nowIsoUtc();
    const result = this.db
      .prepare(
        `UPDATE obra_social_plan
            SET deleted_at = ?, updated_at = ?, activo = 0
          WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(now, now, id);
    return result.changes === 1;
  }
}
