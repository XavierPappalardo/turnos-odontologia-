/**
 * Rutas admin solicitud de reseña (C-19). Auth + RBAC, sin PHI en respuestas/errores.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../../shared/config.js';
import { requireAuth, requireRoles } from '../../auth/middleware.js';
import { SolicitudResenaService } from './service.js';

export function solicitudResenaRouter(db: DatabaseSync, config: AppConfig): Router {
  const router = Router();
  const service = new SolicitudResenaService(db, config);
  const auth = requireAuth(config.jwtSecret, db);
  const puedeOperar = requireRoles('administracion', 'recepcion');

  router.get('/solicitudes-resena', auth, puedeOperar, (req: Request, res: Response, next: NextFunction) => {
    try {
      const limiteRaw = typeof req.query.limite === 'string' ? Number(req.query.limite) : undefined;
      const limite = Number.isFinite(limiteRaw) ? limiteRaw : undefined;
      res.json(service.listarSolicitudes(limite));
    } catch (e) {
      next(e);
    }
  });

  router.get('/solicitudes-resena/:id', auth, puedeOperar, (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(service.obtenerSolicitud(req.params.id));
    } catch (e) {
      next(e);
    }
  });

  return router;
}
