/**
 * Middleware de autenticación/RBAC (C-03).
 * `requireAuth` valida el access token Bearer y publica `res.locals.auth`.
 * `requireRoles` aplica la matriz de permisos. Errores sin PHI (R3).
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Rol, UsuarioId } from '../shared/types.js';
import { verifyToken } from './tokens.js';
import type { AuthContext } from './types.js';

export const AUTH_LOCAL = 'auth';

export function requireAuth(jwtSecret: string): RequestHandler {
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
    const auth: AuthContext = {
      userId: claims.sub as UsuarioId,
      tenantId: claims.tenant_id,
      roles: claims.roles,
      email: claims.email,
      jti: claims.jti,
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
