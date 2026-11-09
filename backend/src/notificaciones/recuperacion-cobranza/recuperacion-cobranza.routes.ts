/**
 * Rutas admin recuperación/cobranza (C-18). Auth + RBAC, sin PHI en respuestas/errores.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../../shared/config.js';
import { getAuth, requireAuth, requireRoles } from '../../auth/middleware.js';
import { RecuperacionCobranzaService } from './service.js';

export function recuperacionCobranzaRouter(db: DatabaseSync, config: AppConfig): Router {
  const router = Router();
  const service = new RecuperacionCobranzaService(db, config);
  const auth = requireAuth(config.jwtSecret, db);
  // Operación administrativa: administracion y recepcion (sin exponer PHI).
  const puedeOperar = requireRoles('administracion', 'recepcion');

  router.get('/recuperacion-cobranza/inactivos', auth, puedeOperar, (req: Request, res: Response, next: NextFunction) => {
    try {
      const ahoraIso = typeof req.query.ahora === 'string' ? req.query.ahora : undefined;
      res.json(service.segmentarInactivos(ahoraIso));
    } catch (e) { next(e); }
  });

  router.post('/recuperacion-cobranza/recuperacion/ejecutar', auth, puedeOperar, (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getAuth(res).userId;
      const ahoraIso = typeof (req.body as { ahora?: string } | undefined)?.ahora === 'string' ? (req.body as { ahora: string }).ahora : undefined;
      res.status(201).json(service.ejecutarRecuperacion(actor, ahoraIso));
    } catch (e) { next(e); }
  });

  router.post('/recuperacion-cobranza/cobranza/ejecutar', auth, puedeOperar, (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getAuth(res).userId;
      const ahoraIso = typeof (req.body as { ahora?: string } | undefined)?.ahora === 'string' ? (req.body as { ahora: string }).ahora : undefined;
      res.status(201).json(service.ejecutarCobranza(actor, ahoraIso));
    } catch (e) { next(e); }
  });

  router.get('/recuperacion-cobranza/ejecuciones', auth, puedeOperar, (req: Request, res: Response, next: NextFunction) => {
    try {
      const tipo = req.query.tipo === 'recuperacion' || req.query.tipo === 'cobranza' ? req.query.tipo : undefined;
      res.json({ ejecuciones: service.listarEjecuciones(tipo) });
    } catch (e) { next(e); }
  });

  router.get('/recuperacion-cobranza/ejecuciones/:id', auth, puedeOperar, (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(service.obtenerEjecucion(req.params.id));
    } catch (e) { next(e); }
  });

  return router;
}
