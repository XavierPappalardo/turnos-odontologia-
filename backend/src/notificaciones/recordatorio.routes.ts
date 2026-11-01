/**
 * Rutas públicas de recordatorios (C-07): procesar y listar pendientes.
 * Sin autenticación JWT. Rate limiting por IP (reusa PublicRateLimiter de C-05).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import {
  procesarRecordatoriosPendientes,
  listarRecordatoriosPendientes,
} from './recordatorio.worker.js';
import { PublicRateLimiter, publicRateLimiterMiddleware } from '../agenda/publicRateLimiter.js';
import type { AppConfig } from '../shared/config.js';

export function recordatorioRouter(
  db: DatabaseSync,
  config: AppConfig,
): Router {
  const router = Router();
  const limiter = new PublicRateLimiter({
    max: config.reservaOnline.rateMax,
    windowSeconds: config.reservaOnline.rateWindowSeconds,
  });
  const rateLimit = publicRateLimiterMiddleware(limiter);

  router.use(rateLimit);

  router.post(
    '/recordatorios/procesar',
    (_req: Request, res: Response, next: NextFunction) => {
      try {
        const procesados = procesarRecordatoriosPendientes(
          db,
          config.recordatorio,
        );
        res.status(200).json({
          procesados,
          total: procesados.length,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/recordatorios/pendientes',
    (_req: Request, res: Response, next: NextFunction) => {
      try {
        const pendientes = listarRecordatoriosPendientes(db);
        res.status(200).json({
          pendientes,
          total: pendientes.length,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
