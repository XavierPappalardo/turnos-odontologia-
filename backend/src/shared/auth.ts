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

export function puedeCrearTurno(rol: Rol | undefined): boolean {
  return rol !== undefined && ROLES_CREAR_TURNO.includes(rol);
}

export function puedeCambiarEstadoTurno(rol: Rol | undefined): boolean {
  return rol !== undefined && ROLES_CAMBIAR_ESTADO.includes(rol);
}
