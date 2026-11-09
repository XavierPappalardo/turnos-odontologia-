/**
 * Brand types de dominio (R10: TypeScript estricto, sin `any`).
 * Cada identificador de dominio es un tipo opaco distinto:
 * `PatientId ≠ TurnoId ≠ ProfesionalId`.
 * Datos ficticios en tests (R1/R12).
 */

declare const __brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type TurnoId = Brand<string, 'TurnoId'>;
export type ProfesionalId = Brand<string, 'ProfesionalId'>;
export type SillonId = Brand<string, 'SillonId'>;
export type PacienteId = Brand<string, 'PacienteId'>;
export type PrestacionId = Brand<string, 'PrestacionId'>;
export type BloqueoId = Brand<string, 'BloqueoId'>;
export type UsuarioId = Brand<string, 'UsuarioId'>;

/** Identificadores de entidades clínicas (C-09). */
export type HcEventoId = Brand<string, 'HcEventoId'>;
export type OdontogramaEventoId = Brand<string, 'OdontogramaEventoId'>;
export type DelegacionHcId = Brand<string, 'DelegacionHcId'>;

/** Identificadores de presupuestos (C-10). */
export type PresupuestoId = Brand<string, 'PresupuestoId'>;
export type ItemPresupuestoId = Brand<string, 'ItemPresupuestoId'>;
export type ObraSocialPlanId = Brand<string, 'ObraSocialPlanId'>;

/** Identificadores de caja (C-11). */
export type PagoId = Brand<string, 'PagoId'>;
export type CajaMovimientoId = Brand<string, 'CajaMovimientoId'>;
export type CierreCajaId = Brand<string, 'CierreCajaId'>;

/** Estados de presupuesto (C-10). */
export type PresupuestoEstado =
  | 'borrador'
  | 'enviado'
  | 'aceptado'
  | 'rechazado'
  | 'vencido';

export const PRESUPUESTO_ESTADOS: readonly PresupuestoEstado[] = [
  'borrador',
  'enviado',
  'aceptado',
  'rechazado',
  'vencido',
] as const;

/** Estados terminales: una vez alcanzados no aceptan más transiciones. */
export const PRESUPUESTO_ESTADOS_TERMINALES: readonly PresupuestoEstado[] = [
  'aceptado',
  'rechazado',
  'vencido',
] as const;

/** Transiciones válidas: desde -> hacia[] */
export const PRESUPUESTO_TRANSICIONES: ReadonlyMap<
  PresupuestoEstado,
  readonly PresupuestoEstado[]
> = new Map([
  ['borrador', ['enviado']],
  ['enviado', ['aceptado', 'rechazado', 'vencido']],
  ['aceptado', []],
  ['rechazado', []],
  ['vencido', []],
]);

/** Interfaces de dominio de presupuestos (C-10).
 * Todos los montos son enteros en centavos (ARS), nunca float (R2/R5/R6).
 */
export interface Presupuesto {
  id: PresupuestoId;
  paciente_id: PacienteId;
  turno_id: TurnoId | null;
  estado: PresupuestoEstado;
  total_centavos: number;
  cobertura_centavos: number;
  saldo_centavos: number;
  obra_social_plan_id: ObraSocialPlanId | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ItemPresupuesto {
  id: ItemPresupuestoId;
  presupuesto_id: PresupuestoId;
  descripcion: string;
  monto_centavos: number;
  pieza_fdi: number | null;
  superficie: SuperficieFdi | null;
  created_at: string;
  deleted_at: string | null;
}

/** Estados de liquidación de obra social (C-12, default [Supuesto] de Open Question 2). */
export type LiquidacionOsEstado = 'borrador' | 'presentada' | 'pagada';

export const LIQUIDACION_OS_ESTADOS: readonly LiquidacionOsEstado[] = [
  'borrador',
  'presentada',
  'pagada',
] as const;

/** Estados terminales: una vez alcanzados no aceptan más transiciones. */
export const LIQUIDACION_OS_ESTADOS_TERMINALES: readonly LiquidacionOsEstado[] =
  ['pagada'] as const;

/** Transiciones válidas: desde -> hacia[] (default [Supuesto] Q2: lineal). */
export const LIQUIDACION_OS_TRANSICIONES: ReadonlyMap<
  LiquidacionOsEstado,
  readonly LiquidacionOsEstado[]
> = new Map([
  ['borrador', ['presentada']],
  ['presentada', ['pagada']],
  ['pagada', []],
]);

/** Eventos del historial append-only de liquidación (design D2 [corr. 3ª ronda]). */
export type LiquidacionOsEvento = 'generada' | 'presentada' | 'pagada';

export const LIQUIDACION_OS_EVENTOS: readonly LiquidacionOsEvento[] = [
  'generada',
  'presentada',
  'pagada',
] as const;

/** Identificadores de obras sociales (C-12). */
export type CoberturaTurnoId = Brand<string, 'CoberturaTurnoId'>;
export type LiquidacionOsId = Brand<string, 'LiquidacionOsId'>;
export type LiquidacionOsItemId = Brand<string, 'LiquidacionOsItemId'>;

/** Interfaces de dominio de obras sociales (C-12).
 * Todos los montos son enteros en centavos (ARS), nunca float (R2/R5/R6).
 */
export interface CoberturaTurno {
  id: CoberturaTurnoId;
  turno_id: TurnoId;
  prestacion_id: PrestacionId;
  obra_social_plan_id: ObraSocialPlanId;
  monto_total_centavos: number;
  cobertura_pct: number;
  cobertura_centavos: number;
  saldo_paciente_centavos: number;
  moneda: 'ARS';
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface LiquidacionOs {
  id: LiquidacionOsId;
  obra_social_plan_id: ObraSocialPlanId;
  desde: string;
  hasta: string;
  estado: LiquidacionOsEstado;
  monto_total_centavos: number;
  generada_por_usuario_id: UsuarioId;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ItemLiquidacionOs {
  id: LiquidacionOsItemId;
  liquidacion_id: LiquidacionOsId;
  cobertura_id: CoberturaTurnoId;
  turno_id: TurnoId;
  monto_cobertura_centavos: number;
  saldo_paciente_centavos: number;
  cobertura_pct: number;
  created_at: string;
  deleted_at: string | null;
}

export interface EventoLiquidacionOs {
  id: string;
  liquidacion_id: LiquidacionOsId;
  evento: LiquidacionOsEvento;
  actor_usuario_id: UsuarioId;
  ocurrido_en: string;
  created_at: string;
}

/** Tipos de dominio de caja (C-11).
 * Los montos son enteros en centavos ARS, nunca float (R2/R5/R6).
 * `medio` reutiliza `PagoMedio` de `core/models.ts` (task 1.2).
 */
export type CajaMovimientoTipo = 'cobro' | 'anulacion';

/** Motivo de asignación de un movimiento cuya fecha contable ya estaba cerrada (design D3). */
export type MotivoAsignacionCaja = 'fecha_ya_cerrada';

export interface CajaMovimiento {
  id: CajaMovimientoId;
  pago_id: PagoId;
  tipo: CajaMovimientoTipo;
  monto_centavos: number;
  moneda: 'ARS';
  actor_usuario_id: UsuarioId;
  /** Día local (YYYY-MM-DD, zona IANA configurada) del evento. */
  fecha_contable: string;
  /** Día contable al que se asigna el movimiento para el snapshot y el resumen. */
  aplicado_en: string;
  /** `NULL` cuando `aplicado_en = fecha_contable`; `fecha_ya_cerrada` si el día ya estaba cerrado (design D3). */
  motivo_asignacion: MotivoAsignacionCaja | null;
  /** Sello UTC de inserción: la fecha/hora de asignación del movimiento. */
  created_at: string;
}

export interface CierreCaja {
  id: CierreCajaId;
  /** Fecha contable (YYYY-MM-DD) única por cierre (RN-09). */
  fecha: string;
  /** Zona horaria IANA usada para calcular la fecha contable (design D11). */
  zona_horaria: string;
  total_efectivo_centavos: number;
  total_tarjeta_centavos: number;
  total_transferencia_centavos: number;
  total_mercadopago_centavos: number;
  /** Ingreso real reembolsado por la obra social, separado del cobrado a bolsillo. */
  total_obra_social_centavos: number;
  anulaciones_cantidad: number;
  anulaciones_centavos: number;
  actor_usuario_id: UsuarioId;
  /** Momento del cierre en ISO-8601 UTC. */
  cerrado_en: string;
  created_at: string;
  updated_at: string;
}

/** Tipos de dominio clínico (C-09). */
export type TipoEventoHc =
  | 'consulta'
  | 'nota'
  | 'diagnostico'
  | 'procedimiento';

export type SuperficieFdi = 'M' | 'D' | 'V' | 'L' | 'O' | 'I';

export type HallazgoOdontograma =
  | 'sano'
  | 'caries'
  | 'obturado'
  | 'ausente'
  | 'corona'
  | 'endodoncia'
  | 'implante'
  | 'extraccion_indicada'
  | 'sellante'
  | 'fractura';

export type TurnoEstado =
  | 'reservado'
  | 'confirmado'
  | 'presente'
  | 'atendido'
  | 'cancelado'
  | 'ausente';

export type TurnoOrigen = 'recepcion' | 'online' | 'whatsapp';

/** Roles del MVP (KB-03). */
export type Rol = 'recepcion' | 'profesional' | 'administracion';
export const ROLES: readonly Rol[] = ['recepcion', 'profesional', 'administracion'];

/** Estados que OCUPAN agenda (RN-01/RN-02, design D4). */
export const ESTADOS_ACTIVOS: readonly TurnoEstado[] = [
  'reservado',
  'confirmado',
  'presente',
] as const;

/** Estados que LIBERAN agenda (design D4). */
export const ESTADOS_LIBRES: readonly TurnoEstado[] = [
  'cancelado',
  'ausente',
  'atendido',
] as const;

export function esEstadoActivo(estado: string): boolean {
  return (ESTADOS_ACTIVOS as readonly string[]).includes(estado);
}

/** Identificadores de comisiones (C-13). */
export type ComisionConfigId = Brand<string, 'ComisionConfigId'>;
export type ComisionTratamientoId = Brand<string, 'ComisionTratamientoId'>;
export type LiquidacionComisionId = Brand<string, 'LiquidacionComisionId'>;
export type LiquidacionComisionItemId = Brand<string, 'LiquidacionComisionItemId'>;
export type LiquidacionComisionAjusteId = Brand<string, 'LiquidacionComisionAjusteId'>;
export type LiquidacionComisionEventoId = Brand<string, 'LiquidacionComisionEventoId'>;

/**
 * Estados de la liquidación de comisiones (C-13, design D5/D9).
 * Máquina lineal: `borrador → confirmada` (terminal). Sin `pagada`/`anulada`
 * (fuera del MVP: el pago efectivo al profesional no se registra).
 */
export type LiquidacionComisionEstado = 'borrador' | 'confirmada';

export const LIQUIDACION_COMISION_ESTADOS: readonly LiquidacionComisionEstado[] =
  ['borrador', 'confirmada'] as const;

/** Estados terminales: una vez alcanzados no aceptan más transiciones. */
export const LIQUIDACION_COMISION_ESTADOS_TERMINALES: readonly LiquidacionComisionEstado[] =
  ['confirmada'] as const;

/** Transiciones válidas: desde -> hacia[] (design D5: lineal). */
export const LIQUIDACION_COMISION_TRANSICIONES: ReadonlyMap<
  LiquidacionComisionEstado,
  readonly LiquidacionComisionEstado[]
> = new Map([
  ['borrador', ['confirmada']],
  ['confirmada', []],
]);

/** Regla aplicada a un ítem de liquidación de comisiones (design D2/RN-08). */
export type ReglaComisionAplicada = 'general' | 'tratamiento';

/** Eventos del historial append-only de liquidación de comisiones (design D9). */
export type EventoComision = 'generada' | 'confirmada';

/** Estado del ciclo de vida del ajuste compensatorio (design D12): `reservado → consumido`. */
export type EstadoAjusteComision = 'reservado' | 'consumido';

/** Tipo de ajuste compensatorio (design D12): anulación de cobro original o arrastre de saldo. */
export type TipoAjusteComision = 'anulacion_cobro' | 'saldo_arrastre';

/** Interfaces de dominio de comisiones (C-13).
 * Todos los montos son enteros en centavos (ARS), nunca float (R2/R5/R6).
 * Los porcentajes `pct_*` son enteros exactos 0..100 (R6).
 * Los snapshots persistidos del borrador/confirmada son inmutables (D4).
 */
export interface ProfesionalComisionConfig {
  id: ComisionConfigId;
  profesional_id: ProfesionalId;
  /** % general del profesional: entero 0..100 (R6, CHECK en DDL). */
  pct_general: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ProfesionalComisionTratamiento {
  id: ComisionTratamientoId;
  profesional_id: ProfesionalId;
  prestacion_id: PrestacionId;
  /** % por (profesional, prestación): reemplaza al general, nunca se suman (RN-08). */
  pct: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface LiquidacionComision {
  id: LiquidacionComisionId;
  profesional_id: ProfesionalId;
  /** Límites del período (Q3 ratificada: fecha contable). */
  desde: string;
  hasta: string;
  estado: LiquidacionComisionEstado;
  /** Σ de comisiones de los ítems vigentes: entero ≥ 0. */
  monto_items_centavos: number;
  /** Σ de ajustes compensatorios reservados/consumidos del host: entero ≥ 0. */
  monto_ajustes_centavos: number;
  /** Neto = items − ajustes. Excepción documentada a R5: puede ser < 0 SOLO por ajustes (CHECK DDL). */
  monto_total_centavos: number;
  /**
   * Saldo de compensación (D12): `0` en `borrador`; en `confirmada`
   * `max(0, monto_ajustes − monto_items)` (CHECK CASE en DDL). Importe pasivo,
   * sin pagos negativos automáticos: reduce comisiones futuras via arrastre.
   */
  saldo_compensacion_centavos: number;
  /** D13: SHA-256 del cálculo al generar/regenerar (auditoría). */
  fingerprint: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ItemLiquidacionComision {
  id: LiquidacionComisionItemId;
  liquidacion_id: LiquidacionComisionId;
  pago_id: PagoId;
  /** Snapshot de valor del turno comisionado (vía turno o presupuesto.turno_id): sin FK (D9). */
  turno_id: TurnoId;
  /** Snapshot D4 de la fecha contable del cobro (movimiento de caja; fallback pago.created_at), `YYYY-MM-DD`. */
  fecha_contable: string;
  /** Snapshot del cobro comisionado: entero ≥ 0. */
  monto_cobro_centavos: number;
  /** % vigente al calcular (Q5: comisión = trunc(monto × pct / 100)). */
  pct_aplicado: number;
  regla_aplicada: ReglaComisionAplicada;
  /** Comisión truncada del ítem: entero ≥ 0. */
  monto_comision_centavos: number;
  created_at: string;
  deleted_at: string | null;
}

export interface LiquidacionComisionAjuste {
  id: LiquidacionComisionAjusteId;
  liquidacion_id: LiquidacionComisionId;
  /** Ítem confirmado de origen (snapshot de la comisión original a compensar). */
  item_origen_id: LiquidacionComisionItemId;
  /** Pago cuyo cobro fue anulado (trazabilidad; mismo pago del ítem de origen). */
  pago_id: PagoId;
  tipo_ajuste: TipoAjusteComision;
  /** Magnitud declarada del ajuste (comisión original o residual): entero > 0. */
  monto_ajuste_centavos: number;
  /** Absorción in-order (D12): `0 .. monto_ajuste_centavos`; la del límite puede quedar parcial. */
  monto_compensado_centavos: number;
  /** Ciclo reservado → consumido (CHECK: `compensado_en` requerido al consumir). */
  estado_ajuste: EstadoAjusteComision;
  /** Sello de absorción; `NULL` mientras `estado_ajuste = 'reservado'`. */
  compensado_en: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface EventoLiquidacionComision {
  id: LiquidacionComisionEventoId;
  liquidacion_id: LiquidacionComisionId;
  evento: EventoComision;
  actor_usuario_id: UsuarioId;
  ocurrido_en: string;
  created_at: string;
}
