/**
 * Middleware de autenticación/RBAC (C-03).
 * `requireAuth` valida el access token Bearer, publica `res.locals.auth` y
 * resuelve `profesional_id` desde la BD en cada request (C-09, D4).
 * `requireRoles` aplica la matriz de permisos. Errores sin PHI (R3).
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { Rol, UsuarioId } from '../shared/types.js';
import { verifyToken } from './tokens.js';
import type { AuthContext, ProfesionalId } from './types.js';

export const AUTH_LOCAL = 'auth';

export function requireAuth(
  jwtSecret: string,
  db: DatabaseSync,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header('authorization');
    if (header === undefined || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'no_autenticado' });
      return;
    }
    const token = header.slice('Bearer '.length).trim();
    const claims = verifyToken(token, jwtSecret, 'access');
    if (claims === undefined) {
      res.status(401).json({ error: 'no_autenticado' });
      return;
    }
    // Resolver profesional_id desde la BD (no del JWT) para evitar acceso stale
    // tras desvincular al profesional (design D4).
    let profesionalId: ProfesionalId | undefined;
    try {
      const row = db
        .prepare('SELECT profesional_id FROM usuario WHERE id = ?')
        .get(claims.sub) as { profesional_id: string | null } | undefined;
      if (row?.profesional_id !== null && row?.profesional_id !== undefined) {
        profesionalId = row.profesional_id as ProfesionalId;
      }
    } catch {
      // columna no disponible aún (antes de migración 008): profesionalId queda undefined
    }
    const auth: AuthContext = {
      userId: claims.sub as UsuarioId,
      tenantId: claims.tenant_id,
      roles: claims.roles,
      email: claims.email,
      jti: claims.jti,
      ...(profesionalId !== undefined ? { profesionalId } : {}),
    };
    res.locals[AUTH_LOCAL] = auth;
    next();
  };
}

export function requireRoles(...roles: readonly Rol[]): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const auth = res.locals[AUTH_LOCAL] as AuthContext | undefined;
    if (auth === undefined) {
      res.status(401).json({ error: 'no_autenticado' });
      return;
    }
    if (!auth.roles.some((rol) => roles.includes(rol))) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}

export function getAuth(res: Response): AuthContext {
  return res.locals[AUTH_LOCAL] as AuthContext;
}
