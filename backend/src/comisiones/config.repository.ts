/**
 * Repositorios de configuración de comisiones (C-13, tasks 3.1; R8).
 * `profesional_comision` (% general, UNIQUE activa por profesional) y
 * `profesional_comision_tratamiento` (% por par (profesional, prestación),
 * UNIQUE activa por par). Soft delete íntegro (indeces parciales de 012):
 * la desactivación libera la unicidad y permite re-crear la configuración.
 * El rango 0..100 lo garantiza el CHECK del DDL (el servicio lo valida
 * temprano; el repositorio no duplica la regla).
 */
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { BaseRepository, nowIsoUtc, softDeleteStamp } from '../shared/repository.js';

export interface ProfesionalComisionRow {
  id: string;
  profesional_id: string;
  /** % general: entero 0..100 (R6, CHECK DDL). */
  pct_general: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export class ProfesionalComisionRepository extends BaseRepository<ProfesionalComisionRow> {
  constructor(db: DatabaseSync) {
    super(db, 'profesional_comision');
  }

  /** Config activa del profesional (máximo una por el índice parcial de 012). */
  obtenerConfigVigente(
    profesionalId: string,
  ): ProfesionalComisionRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM profesional_comision
          WHERE profesional_id = ? AND deleted_at IS NULL`,
      )
      .get(profesionalId) as ProfesionalComisionRow | undefined;
  }

  /**
   * Alta o actualización de la config activa del profesional (tasks 3.1).
   * Atómico a nivel BD contra el índice único parcial `com_config_prof_activa`:
   * si no hay config vigente inserta; si la hay, actualiza el % conservando
   * el mismo id (evita carreras de insert/update). Llamar dentro del
   * UnitOfWork del servicio (Bloque 5).
   */
  upsert(args: {
    profesionalId: string;
    pctGeneral: number;
  }): ProfesionalComisionRow | undefined {
    const ahora = nowIsoUtc();
    this.db
      .prepare(
        `INSERT INTO profesional_comision
            (id, profesional_id, pct_general, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(profesional_id) WHERE deleted_at IS NULL DO UPDATE SET
            pct_general = excluded.pct_general,
            updated_at = excluded.updated_at`,
      )
      .run(
        randomUUID(),
        args.profesionalId,
        args.pctGeneral,
        ahora,
        ahora,
      );
    return this.obtenerConfigVigente(args.profesionalId);
  }

  /** Baja lógica de la config por id (libera la unicidad del índice parcial). */
  softDelete(id: string): boolean {
    return super.softDelete(id);
  }
}

export interface ProfesionalComisionTratamientoRow {
  id: string;
  profesional_id: string;
  prestacion_id: string;
  /** % del par: reemplaza al general, nunca se suma (RN-08, D2). */
  pct: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export class ProfesionalComisionTratamientoRepository extends BaseRepository<ProfesionalComisionTratamientoRow> {
  constructor(db: DatabaseSync) {
    super(db, 'profesional_comision_tratamiento');
  }

  /** Config específica vigente del par (profesional, prestación). */
  obtenerVigentePorPrestacion(
    profesionalId: string,
    prestacionId: string,
  ): ProfesionalComisionTratamientoRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM profesional_comision_tratamiento
          WHERE profesional_id = ? AND prestacion_id = ? AND deleted_at IS NULL`,
      )
      .get(profesionalId, prestacionId) as
      ProfesionalComisionTratamientoRow | undefined;
  }

  /** Vigentes del profesional, ordenados canónicos por `prestacion_id` (D13). */
  listarVigentes(profesionalId: string): ProfesionalComisionTratamientoRow[] {
    return this.db
      .prepare(
        `SELECT * FROM profesional_comision_tratamiento
          WHERE profesional_id = ? AND deleted_at IS NULL
          ORDER BY prestacion_id ASC`,
      )
      .all(profesionalId) as unknown as ProfesionalComisionTratamientoRow[];
  }

  /**
   * Alta o actualización del par (profesional, prestación) — atómico contra
   * el índice parcial `com_tratamiento_par_activa`. Id conserva la primera
   * inserción mientras la fila esté vigente.
   */
  upsert(args: {
    profesionalId: string;
    prestacionId: string;
    pct: number;
  }): ProfesionalComisionTratamientoRow | undefined {
    const ahora = nowIsoUtc();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO profesional_comision_tratamiento
            (id, profesional_id, prestacion_id, pct, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(profesional_id, prestacion_id) WHERE deleted_at IS NULL DO UPDATE SET
            pct = excluded.pct,
            updated_at = excluded.updated_at`,
      )
      .run(id, args.profesionalId, args.prestacionId, args.pct, ahora, ahora);
    return this.obtenerVigentePorPrestacion(
      args.profesionalId,
      args.prestacionId,
    );
  }

  /** Baja lógica del par por id (libera la unicidad del índice parcial). */
  desactivar(id: string): boolean {
    const stamp = softDeleteStamp();
    const result = this.db
      .prepare(
        `UPDATE profesional_comision_tratamiento
            SET deleted_at = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(stamp.deleted_at, nowIsoUtc(), id);
    return result.changes === 1;
  }
}
