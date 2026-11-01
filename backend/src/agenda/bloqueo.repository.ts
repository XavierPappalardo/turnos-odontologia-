/**
 * BloqueoRepository: dueño del SQL de bloqueos (R8, design D2).
 * NULL en profesional_id/sillon_id = global.
 */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { BaseRepository } from '../shared/repository.js';
import type {
  BloqueoId,
  ProfesionalId,
  SillonId,
  TurnoId,
} from '../shared/types.js';

/** Solo bloqueos no dados de baja aplican a la agenda (design D3). */
const BLOQUEO_VIGENTE_SQL = 'deleted_at IS NULL';

/** Estados que ocupan agenda al calcular la intersección (design D2). */
const TURNOS_ACTIVOS_SQL = `('reservado', 'confirmado', 'presente')`;

/** Fórmula única de intersección semiabierta [inicio, fin) (design D2). */
const INTERSECCION_INICIO_SQL = 'inicio < ?';
const INTERSECCION_FIN_SQL = 'fin > ?';
const INTERSECCION_SQL = `${INTERSECCION_INICIO_SQL} AND ${INTERSECCION_FIN_SQL}`;

export interface BloqueoRow {
  id: string;
  profesional_id: string | null;
  sillon_id: string | null;
  inicio: string;
  fin: string;
  motivo: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface NuevoBloqueo {
  id: BloqueoId;
  profesionalId: ProfesionalId | null;
  sillonId: SillonId | null;
  inicio: string;
  fin: string;
  motivo?: string | null;
}

/** Columnas editables de un bloqueo (design D2). */
export type BloqueoEditable = Partial<
  Pick<BloqueoRow, 'profesional_id' | 'sillon_id' | 'inicio' | 'fin' | 'motivo'>
>;

/** Filtros del listado (design D2): ausente = sin filtro. */
export interface FiltroBloqueos {
  profesionalId?: string;
  sillonId?: string;
  desde?: string;
  hasta?: string;
}

export class BloqueoRepository extends BaseRepository<BloqueoRow> {
  constructor(db: DatabaseSync) {
    super(db, 'bloqueo');
  }

  crear(input: NuevoBloqueo): void {
    this.insert({
      id: input.id,
      profesional_id: input.profesionalId,
      sillon_id: input.sillonId,
      inicio: input.inicio,
      fin: input.fin,
      motivo: input.motivo ?? null,
      deleted_at: null,
    });
  }

  /** FK activa para bloqueos (design D4): existe, activa y no dada de baja. */
  existeFkActiva(tabla: 'profesional' | 'sillon', id: string): boolean {
    const stmt = this.db.prepare(
      `SELECT 1 FROM ${tabla}
        WHERE id = ? AND activo = 1 AND deleted_at IS NULL
        LIMIT 1`,
    );
    return stmt.get(id) !== undefined;
  }

  actualizar(id: BloqueoId, patch: BloqueoEditable): boolean {
    return this.update(id, patch);
  }

  bajaLogica(id: BloqueoId): boolean {
    return this.softDelete(id);
  }

  buscarVigente(id: BloqueoId): BloqueoRow | undefined {
    const stmt = this.db.prepare(
      `SELECT * FROM bloqueo WHERE id = ? AND ${BLOQUEO_VIGENTE_SQL}`,
    );
    return stmt.get(id) as BloqueoRow | undefined;
  }

  listar(filtros: FiltroBloqueos): BloqueoRow[] {
    const condiciones: string[] = [BLOQUEO_VIGENTE_SQL];
    const params: SQLInputValue[] = [];
    if (filtros.profesionalId !== undefined) {
      condiciones.push('profesional_id = ?');
      params.push(filtros.profesionalId);
    }
    if (filtros.sillonId !== undefined) {
      condiciones.push('sillon_id = ?');
      params.push(filtros.sillonId);
    }
    if (filtros.hasta !== undefined) {
      condiciones.push(INTERSECCION_INICIO_SQL);
      params.push(filtros.hasta);
    }
    if (filtros.desde !== undefined) {
      condiciones.push(INTERSECCION_FIN_SQL);
      params.push(filtros.desde);
    }
    const stmt = this.db.prepare(
      `SELECT * FROM bloqueo WHERE ${condiciones.join(' AND ')} ORDER BY inicio`,
    );
    return stmt.all(...params) as unknown as BloqueoRow[];
  }

  /**
   * Ids de turnos activos que intersectan el rango del bloqueo (design D2).
   * Globabilidad: NULL en profesional/sillón aplica a todos. Solo ids opacos (R3).
   */
  turnosActivosEnInterseccion(
    profesionalId: string | null,
    sillonId: string | null,
    inicio: string,
    fin: string,
  ): TurnoId[] {
    const stmt = this.db.prepare(
      `SELECT id FROM turno
        WHERE estado IN ${TURNOS_ACTIVOS_SQL}
          AND deleted_at IS NULL
          AND ${INTERSECCION_SQL}
          AND (? IS NULL OR profesional_id = ?)
          AND (? IS NULL OR sillon_id = ?)
        ORDER BY inicio`,
    );
    const filas = stmt.all(
      fin,
      inicio,
      profesionalId,
      profesionalId,
      sillonId,
      sillonId,
    ) as { id: string }[];
    return filas.map((fila) => fila.id as TurnoId);
  }

  existeBloqueoAplicable(
    profesionalId: ProfesionalId,
    sillonId: SillonId,
    nuevoInicio: string,
    nuevoFin: string,
  ): boolean {
    const stmt = this.db.prepare(
      `SELECT 1 FROM bloqueo
        WHERE ${BLOQUEO_VIGENTE_SQL}
          AND (profesional_id IS NULL OR profesional_id = ?)
          AND (sillon_id IS NULL OR sillon_id = ?)
          AND inicio < ?
          AND fin > ?
        LIMIT 1`,
    );
    return (
      stmt.get(profesionalId, sillonId, nuevoFin, nuevoInicio) !== undefined
    );
  }
}
