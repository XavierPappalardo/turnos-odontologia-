/**
 * Modelos core (C-02): tipos de fila + AuditMixin.
 * Los montos son enteros en centavos (R2/R5); los porcentajes enteros 0..100 (R6).
 */
import type { AuditRow } from '../shared/repository.js';

export interface ProfesionalRow extends AuditRow {
  id: string;
  nombre: string;
  matricula: string | null;
  especialidad: string | null;
  activo: number;
}

export interface SillonRow extends AuditRow {
  id: string;
  nombre: string;
  activo: number;
}

export interface PacienteRow extends AuditRow {
  id: string;
  nombre: string;
  telefono_whatsapp: string | null;
  obra_social_plan_id: string | null;
  activo: number;
}

export interface PrestacionRow extends AuditRow {
  id: string;
  codigo: string;
  nombre: string;
  duracion_min: number;
  activo: number;
}

export interface ObraSocialPlanRow extends AuditRow {
  id: string;
  obra_social: string;
  plan: string;
  cobertura_pct: number;
  activo: number;
}

export type PagoMedio =
  | 'efectivo'
  | 'tarjeta'
  | 'transferencia'
  | 'mercadopago'
  | 'obra_social';

export type PagoEstado = 'pendiente' | 'cobrado' | 'anulado';

export interface PagoRow extends AuditRow {
  id: string;
  turno_id: string;
  monto_centavos: number;
  moneda: 'ARS';
  medio: PagoMedio;
  estado: PagoEstado;
}
