/**
 * Auth/RBAC mínima ([Supuesto] C-03 dentro del alcance de C-04).
 * Contrato supuesto: roles `recepcion`, `profesional`, `administracion`.
 * Solo `recepcion` y `administracion` crean turnos (spec: Autorización).
 * Sin PHI en errores/logs (R3): solo ids opacos + códigos.
 */
import type { NextFunction, Request, Response } from 'express';

export type Rol = 'recepcion' | 'profesional' | 'administracion';

const ROLES_CREAR_TURNO: readonly Rol[] = ['recepcion', 'administracion'];

/**
 * Extrae el rol del request. En C-03 real vendrá del JWT (`claims sub,
 * roles, ...`); aquí se acepta header `x-role` como stub documentado
 * [Supuesto] para no bloquear C-04. Sin PHI: el rol no identifica pacientes.
 */
export function extraerRol(req: Request): Rol | undefined {
  const raw = req.header('x-role');
  if (raw === 'recepcion' || raw === 'profesional' || raw === 'administracion') {
    return raw;
  }
  return undefined;
}

export function puedeCrearTurno(rol: Rol | undefined): boolean {
  if (rol === undefined) return false;
  return ROLES_CREAR_TURNO.includes(rol);
}

/** Middleware RBAC para POST /api/turnos → 403 sin PHI. */
export function requireCrearTurno(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!puedeCrearTurno(extraerRol(req))) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
}
