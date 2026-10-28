/**
 * Endpoints de auth (C-03): login, refresh, logout, me.
 * Refresh en cookie HttpOnly + SameSite=Lax; access token en body.
 * Errores centralizados sin PHI ni secretos (R3).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { AuthError } from '../shared/errors.js';
import { AuthService } from './auth.service.js';
import { readCookie } from './cookies.js';
import { getAuth, requireAuth } from './middleware.js';
import type { AuthConfig } from './types.js';

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_PATH = '/api/auth';

function cookieOptions(config: AuthConfig): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: REFRESH_PATH,
    maxAge: config.refreshTokenTtlSeconds * 1000,
  };
}

function sendAuth(
  res: Response,
  result: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: unknown;
  },
  config: AuthConfig,
): void {
  res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions(config));
  res.status(200).json({
    access_token: result.accessToken,
    token_type: 'Bearer',
    expires_in: result.expiresIn,
    user: result.user,
  });
}

export function authRouter(db: DatabaseSync, config: AuthConfig): Router {
  const router = Router();
  const service = new AuthService(db, config);

  router.post('/auth/login', (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as { email?: unknown; password?: unknown };
      if (typeof body.email !== 'string' || typeof body.password !== 'string') {
        res.status(400).json({ error: 'validacion' });
        return;
      }
      const result = service.login(
        body.email,
        body.password,
        req.ip ?? 'desconocida',
      );
      sendAuth(res, result, config);
    } catch (err) {
      if (err instanceof AuthError && err.retryAfterSeconds !== undefined) {
        res.setHeader('Retry-After', String(err.retryAfterSeconds));
      }
      next(err);
    }
  });

  router.post('/auth/refresh', (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = readCookie(req, REFRESH_COOKIE);
      if (token === undefined) {
        throw new AuthError({
          status: 401,
          code: 'credenciales_invalidas',
          message: 'refresh ausente',
        });
      }
      const result = service.refresh(token);
      sendAuth(res, result, config);
    } catch (err) {
      next(err);
    }
  });

  router.post('/auth/logout', (req: Request, res: Response) => {
    service.logout(readCookie(req, REFRESH_COOKIE));
    res.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
      path: REFRESH_PATH,
    });
    res.status(204).end();
  });

  router.get('/auth/me', requireAuth(config.jwtSecret), (req: Request, res: Response) => {
    const auth = getAuth(res);
    const user = service.me(auth.userId);
    res.status(200).json({ user });
  });

  return router;
}
