/**
 * Rutas públicas de acciones de turno (C-06): confirmar, cancelar, reprogramar.
 * Sin autenticación JWT. Requieren token de acción como query parameter.
 * Rate limiting por IP (reusa PublicRateLimiter de C-05).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { ejecutarAccionTurno, type AccionTurnoInput } from './turnoToken.service.js';
import { PublicRateLimiter, publicRateLimiterMiddleware } from './publicRateLimiter.js';
import type { AppConfig } from '../shared/config.js';

export function turnoTokenRouter(
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
    '/turnos/:id/confirmar',
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const input: AccionTurnoInput = {
          turnoId: req.params['id'] as string,
          accion: 'confirmar',
          token: typeof req.query.token === 'string' ? req.query.token : '',
        };
        const resultado = ejecutarAccionTurno(db, input, config);
        res.status(200).json({
          id: resultado.id,
          estado: resultado.estado,
          origen: resultado.origen,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/turnos/:id/cancelar',
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const input: AccionTurnoInput = {
          turnoId: req.params['id'] as string,
          accion: 'cancelar',
          token: typeof req.query.token === 'string' ? req.query.token : '',
        };
        const resultado = ejecutarAccionTurno(db, input, config);
        res.status(200).json({
          id: resultado.id,
          estado: resultado.estado,
          origen: resultado.origen,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/turnos/:id/reprogramar',
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = (req.body ?? {}) as {
          nuevo_inicio?: unknown;
          nuevo_fin?: unknown;
        };
        const input: AccionTurnoInput = {
          turnoId: req.params['id'] as string,
          accion: 'reprogramar',
          token: typeof req.query.token === 'string' ? req.query.token : '',
        };
        if (typeof body.nuevo_inicio === 'string') {
          input.nuevoInicio = body.nuevo_inicio;
        }
        if (typeof body.nuevo_fin === 'string') {
          input.nuevoFin = body.nuevo_fin;
        }
        const resultado = ejecutarAccionTurno(db, input, config);
        res.status(200).json({
          id: resultado.id,
          estado: resultado.estado,
          origen: resultado.origen,
          turno_reprogramado: resultado.turnoReprogramado,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
