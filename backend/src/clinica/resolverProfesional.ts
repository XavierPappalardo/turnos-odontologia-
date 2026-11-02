/**
 * C-09 task 5.1: resolverProfesional.
 * Guard de acceso clínico: verifica que `AuthContext.profesionalId` esté presente.
 * Si es null/undefined (usuario sin vínculo o desvinculado), responde 403 `sin_vinculo`.
 * Diseño D4: `profesional_id` ya fue resuelto por `requireAuth` desde la BD en cada request.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { NextFunction, Request, Response } from 'express';
import type { AuthContext } from '../auth/types.js';
import { AUTH_LOCAL } from '../auth/middleware.js';

export function resolverProfesional(
  _jwtSecret: string,
  _db: DatabaseSync,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = res.locals[AUTH_LOCAL] as AuthContext | undefined;
    if (auth === undefined || !auth.profesionalId) {
      res.status(403).json({ error: 'sin_vinculo' });
      return;
    }
    next();
  };
}
