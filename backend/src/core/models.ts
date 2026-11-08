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
  fecha_nacimiento: string | null;
  alergias: string | null;
}

export interface PrestacionRow extends AuditRow {
  id: string;
  codigo: string;
  nombre: string;
  duracion_min: number;
  precio_base_centavos?: number;
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
  /** Visible desde la migración 010 (C-11): nullable para cobros aplicados a presupuesto sin turno. */
  turno_id: string | null;
  /** Visible desde la migración 010 (C-11): FK a presupuesto con CHECK de aplicación obligatoria. */
  presupuesto_id?: string | null;
  monto_centavos: number;
  moneda: 'ARS';
  medio: PagoMedio;
  estado: PagoEstado;
  /** Clave de idempotencia del cobro (UNIQUE parcial, C-11 design D5). */
  clave_idempotencia?: string | null;
  /** Referencia del medio (p. ej. últimos 4 dígitos de transferencia o id de pago MP). */
  referencia?: string | null;
  actor_usuario_id?: string | null;
  anulado_por_usuario_id?: string | null;
  motivo_anulacion?: string | null;
  anulado_en?: string | null;
}
