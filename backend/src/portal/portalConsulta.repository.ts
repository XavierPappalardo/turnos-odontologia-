/**
 * Consultas read-only del portal paciente, acotadas por paciente_id (C-17, R8).
 * DTOs seguros: sin PHI innecesaria, sin edición clínica.
 */
import type { DatabaseSync } from 'node:sqlite';

export interface PortalTurnoDto {
  id: string;
  profesional_id: string;
  sillon_id: string;
  prestacion_id: string | null;
  inicio: string;
  fin: string;
  estado: string;
  origen: string;
}

export interface PortalPresupuestoDto {
  id: string;
  turno_id: string | null;
  estado: string;
  total_centavos: number;
  cobertura_centavos: number;
  saldo_centavos: number;
  moneda: string;
  created_at: string;
  updated_at: string;
}

export class PortalConsultaRepository {
  constructor(private readonly db: DatabaseSync) {}

  listarTurnos(pacienteId: string): PortalTurnoDto[] {
    return this.db
      .prepare(
        `SELECT id, profesional_id, sillon_id, prestacion_id, inicio, fin, estado, origen
         FROM turno WHERE paciente_id = ? ORDER BY inicio DESC, id DESC`,
      )
      .all(pacienteId) as unknown as PortalTurnoDto[];
  }

  listarPresupuestos(pacienteId: string): PortalPresupuestoDto[] {
    const rows = this.db
      .prepare(
        `SELECT id, turno_id, estado, total_centavos, cobertura_centavos, saldo_centavos, created_at, updated_at
         FROM presupuesto WHERE paciente_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC`,
      )
      .all(pacienteId) as Array<Omit<PortalPresupuestoDto, 'moneda'>>;
    return rows.map((r) => ({ ...r, moneda: 'ARS' }));
  }
}
