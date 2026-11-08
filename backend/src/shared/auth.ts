/**
 * Reglas RBAC compartidas (C-03).
 * La autenticación real vive en `src/auth/*`; este módulo solo contiene la
 * matriz de permisos reutilizable por servicios y tests.
 */
import type { Rol } from './types.js';

export type { Rol } from './types.js';

export const ROLES_CREAR_TURNO: readonly Rol[] = ['recepcion', 'administracion'];
export const ROLES_CAMBIAR_ESTADO: readonly Rol[] = [
  'recepcion',
  'administracion',
];

/** Gestión y lectura de bloqueos: recepción y administración (design D6). */
export const ROLES_BLOQUEOS: readonly Rol[] = ['recepcion', 'administracion'];

export function puedeCrearTurno(rol: Rol | undefined): boolean {
  return rol !== undefined && ROLES_CREAR_TURNO.includes(rol);
}

export function puedeCambiarEstadoTurno(rol: Rol | undefined): boolean {
  return rol !== undefined && ROLES_CAMBIAR_ESTADO.includes(rol);
}

export function puedeGestionarBloqueos(rol: Rol | undefined): boolean {
  return rol !== undefined && ROLES_BLOQUEOS.includes(rol);
}

/**
 * Contrato de lectura testeable (design D6). Mismo conjunto de roles que la
 * gestión: quien lee ve todos los bloqueos vigentes, sin acotamiento por query.
 */
export function puedeLeerBloqueos(rol: Rol | undefined): boolean {
  return rol !== undefined && ROLES_BLOQUEOS.includes(rol);
}

/* ── Obras sociales/planes (C-12, design D7; R4: recepción NO configura) ── */

export const ROLES_OS_PLAN_GESTION: readonly Rol[] = ['administracion'];
export const ROLES_OS_PLAN_LECTURA: readonly Rol[] = [
  'recepcion',
  'profesional',
  'administracion',
];

export function puedeGestionarPlanesOs(rol: Rol | undefined): boolean {
  return rol !== undefined && ROLES_OS_PLAN_GESTION.includes(rol);
}

export function puedeLeerPlanesOs(rol: Rol | undefined): boolean {
  return rol !== undefined && ROLES_OS_PLAN_LECTURA.includes(rol);
}

/* ── Cobertura por turno (C-12, design D7; FL-04 paso 1: "En recepción") ── */

export const ROLES_OS_COBERTURA_GESTION: readonly Rol[] = [
  'recepcion',
  'administracion',
];
export const ROLES_OS_COBERTURA_LECTURA: readonly Rol[] = [
  'recepcion',
  'profesional',
  'administracion',
];

export function puedeGestionarCoberturasOs(rol: Rol | undefined): boolean {
  return rol !== undefined && ROLES_OS_COBERTURA_GESTION.includes(rol);
}

export function puedeLeerCoberturasOs(rol: Rol | undefined): boolean {
  return rol !== undefined && ROLES_OS_COBERTURA_LECTURA.includes(rol);
}

/* ── Liquidación de reintegros (C-12, design D7; FL-05: "Administración confirma") ── */

export const ROLES_OS_LIQUIDACION: readonly Rol[] = ['administracion'];

export function puedeOperarLiquidacionesOs(rol: Rol | undefined): boolean {
  return rol !== undefined && ROLES_OS_LIQUIDACION.includes(rol);
}

/* ── Caja / cobros / multimedio (C-11, design D6; FL-04: "En recepción") ── */

/** Gestión de caja: registrar cobros, anular, historiales, saldo y deuda de un turno/paciente. */
export const ROLES_CAJA_GESTION: readonly Rol[] = ['recepcion', 'administracion'];

/** Cierre de caja, resumen, historial de movimientos y confirmación MP: solo administración. */
export const ROLES_CAJA_CIERRE: readonly Rol[] = ['administracion'];

export function puedeGestionarCaja(rol: Rol | undefined): boolean {
  return rol !== undefined && ROLES_CAJA_GESTION.includes(rol);
}

export function puedeCerrarCaja(rol: Rol | undefined): boolean {
  return rol !== undefined && ROLES_CAJA_CIERRE.includes(rol);
}

/* ── Comisiones (C-13, design D6; R4: recepción NO configura ni gestiona) ── */

/** Configurar % de comisiones (general y por tratamiento): solo administración. */
export const ROLES_COM_CONFIG: readonly Rol[] = ['administracion'];

/** Preview / generar / regenerar / confirmar / consultar todas las liquidaciones: solo administración. */
export const ROLES_COM_GESTION: readonly Rol[] = ['administracion'];

export function puedeConfigurarComisiones(rol: Rol | undefined): boolean {
  return rol !== undefined && ROLES_COM_CONFIG.includes(rol);
}

export function puedeOperarComisiones(rol: Rol | undefined): boolean {
  return rol !== undefined && ROLES_COM_GESTION.includes(rol);
}
