import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../../shared/config.js';
import { requireAuth, requireRoles } from '../../auth/middleware.js';
import { DemoMigracionService } from './service.js';

export function demoMigracionRouter(db: DatabaseSync, config: AppConfig): Router {
  const router = Router();
  const service = new DemoMigracionService(db);
  const auth = requireAuth(config.jwtSecret, db);
  const soloAdmin = requireRoles('administracion');

  router.post('/utilidades/demo', auth, soloAdmin, (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(201).json(service.cargarDemo());
    } catch (e) {
      next(e);
    }
  });

  router.post('/utilidades/importacion/preview', auth, soloAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.preview(req.body);
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  router.post('/utilidades/importacion/confirmar', auth, soloAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.confirmar(req.body);
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  });

  return router;
}
