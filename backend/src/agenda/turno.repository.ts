/**
 * TurnoRepository (R8: extiende BaseRepository; R9: intersección
 * `inicio < nuevo_fin AND fin > nuevo_inicio` + estados activos).
 */
import type { DatabaseSync } from 'node:sqlite';
import { BaseRepository } from '../shared/repository.js';
import type {
  PacienteId,
  ProfesionalId,
  PrestacionId,
  SillonId,
  TurnoEstado,
  TurnoId,
  TurnoOrigen,
} from '../shared/types.js';

export interface TurnoRow {
  id: string;
  profesional_id: string;
  sillon_id: string;
  paciente_id: string;
  prestacion_id: string | null;
  inicio: string;
  fin: string;
  estado: TurnoEstado;
  origen: TurnoOrigen;
  created_at: string;
  updated_at: string;
}

export interface NuevoTurno {
  id: TurnoId;
  profesionalId: ProfesionalId;
  sillonId: SillonId;
  pacienteId: PacienteId;
  prestacionId?: PrestacionId | undefined;
  inicio: string;
  fin: string;
  estado: TurnoEstado;
  origen: TurnoOrigen;
}

const ESTADOS_ACTIVOS_SQL = `('reservado', 'confirmado', 'presente')`;

export class TurnoRepository extends BaseRepository<TurnoRow> {
  constructor(db: DatabaseSync) {
    super(db, 'turno');
  }

  crear(input: NuevoTurno): void {
    this.insert({
      id: input.id,
      profesional_id: input.profesionalId,
      sillon_id: input.sillonId,
      paciente_id: input.pacienteId,
      prestacion_id: input.prestacionId ?? null,
      inicio: input.inicio,
      fin: input.fin,
      estado: input.estado,
      origen: input.origen,
    });
  }

  /**
   * ¿Existe solape por profesional? (design D2, eje profesional).
   * Intervalo semiabierto [inicio, fin): contigüidad NO es intersección.
   */
  existeSolapeProfesional(
    profesionalId: ProfesionalId,
    nuevoInicio: string,
    nuevoFin: string,
  ): boolean {
    const stmt = this.db.prepare(
      `SELECT 1 FROM turno
        WHERE profesional_id = ?
          AND estado IN ${ESTADOS_ACTIVOS_SQL}
          AND inicio < ?
          AND fin > ?
        LIMIT 1`,
    );
    return stmt.get(profesionalId, nuevoFin, nuevoInicio) !== undefined;
  }

  /** ¿Existe solape por sillón? (design D2, eje sillón). */
  existeSolapeSillon(
    sillonId: SillonId,
    nuevoInicio: string,
    nuevoFin: string,
  ): boolean {
    const stmt = this.db.prepare(
      `SELECT 1 FROM turno
        WHERE sillon_id = ?
          AND estado IN ${ESTADOS_ACTIVOS_SQL}
          AND inicio < ?
          AND fin > ?
        LIMIT 1`,
    );
    return stmt.get(sillonId, nuevoFin, nuevoInicio) !== undefined;
  }

  contarActivosEnHueco(
    profesionalId: ProfesionalId,
    sillonId: SillonId,
    inicio: string,
    fin: string,
  ): number {
    const stmt = this.db.prepare(
      `SELECT COUNT(*) AS n FROM turno
        WHERE profesional_id = ?
          AND sillon_id = ?
          AND estado IN ${ESTADOS_ACTIVOS_SQL}
          AND inicio < ?
          AND fin > ?`,
    );
    const row = stmt.get(profesionalId, sillonId, fin, inicio) as { n: number };
    return row.n;
  }
}
