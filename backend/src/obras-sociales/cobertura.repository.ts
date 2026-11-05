/**
 * Repositorio de coberturas de obra social por turno (C-12, R8).
 * SQL encapsulado exclusivamente aquí.
 */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { BaseRepository } from '../shared/repository.js';

export interface CoberturaTurnoRow {
  id: string;
  turno_id: string;
  prestacion_id: string;
  obra_social_plan_id: string;
  monto_total_centavos: number;
  cobertura_pct: number;
  cobertura_centavos: number;
  saldo_paciente_centavos: number;
  moneda: 'ARS';
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Fila mínima de turno para validar el cargo (sin PHI: solo ids, estado y fechas). */
export interface TurnoParaCoberturaRow {
  id: string;
  paciente_id: string;
  prestacion_id: string | null;
  profesional_id: string;
  estado: string;
  inicio: string;
  deleted_at: string | null;
}

/** Fila mínima de paciente para resolver el plan del cargo (sin PHI). */
export interface PacienteParaCoberturaRow {
  id: string;
  obra_social_plan_id: string | null;
  deleted_at: string | null;
}

export class CoberturaRepository extends BaseRepository<CoberturaTurnoRow> {
  constructor(db: DatabaseSync) {
    super(db, 'obra_social_cobertura_turno');
  }

  buscarPorIdVigente(id: string): CoberturaTurnoRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM obra_social_cobertura_turno WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(id) as CoberturaTurnoRow | undefined;
  }

  buscarPorTurnoIdVigente(turnoId: string): CoberturaTurnoRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM obra_social_cobertura_turno WHERE turno_id = ? AND deleted_at IS NULL`,
      )
      .get(turnoId) as CoberturaTurnoRow | undefined;
  }

  listarVigentes(): CoberturaTurnoRow[] {
    return this.db
      .prepare(
        `SELECT * FROM obra_social_cobertura_turno WHERE deleted_at IS NULL ORDER BY created_at DESC`,
      )
      .all() as unknown as CoberturaTurnoRow[];
  }

  listarPorProfesional(profesionalId: string): CoberturaTurnoRow[] {
    return this.db
      .prepare(
        `SELECT c.* FROM obra_social_cobertura_turno c
         JOIN turno t ON t.id = c.turno_id
         WHERE t.profesional_id = ? AND c.deleted_at IS NULL
         ORDER BY c.created_at DESC`,
      )
      .all(profesionalId) as unknown as CoberturaTurnoRow[];
  }

  estaEnLiquidacionVigente(coberturaId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM obra_social_liquidacion_item WHERE cobertura_id = ? AND deleted_at IS NULL LIMIT 1`,
      )
      .get(coberturaId);
    return row !== undefined;
  }

  /** Lectura de apoyo para la validación del cargo (R8: SQL solo en repos). */
  buscarTurnoPorId(turnoId: string): TurnoParaCoberturaRow | undefined {
    return this.db
      .prepare(
        `SELECT id, paciente_id, prestacion_id, profesional_id, estado, inicio, deleted_at
           FROM turno WHERE id = ?`,
      )
      .get(turnoId) as TurnoParaCoberturaRow | undefined;
  }

  /** Lectura de apoyo para resolver el plan del paciente (R8: SQL solo en repos). */
  buscarPacientePorId(pacienteId: string): PacienteParaCoberturaRow | undefined {
    return this.db
      .prepare(
        `SELECT id, obra_social_plan_id, deleted_at FROM paciente WHERE id = ?`,
      )
      .get(pacienteId) as PacienteParaCoberturaRow | undefined;
  }
}
