/**
 * Rutas de planes de obra social (C-12, F-08).
 * RBAC: lectura para todos los roles; gestión exclusiva de administración (R4).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { requireAuth, requireRoles } from '../auth/middleware.js';
import type { AuthConfig } from '../auth/types.js';
import {
  ROLES_OS_PLAN_GESTION,
  ROLES_OS_PLAN_LECTURA,
} from '../shared/auth.js';
import { PlanesService } from './planes.service.js';

export function planesRouter(db: DatabaseSync, config: AuthConfig): Router {
  const router = Router();
  const service = new PlanesService(db);
  const autenticado = requireAuth(config.jwtSecret, db);

  // GET /planes
  router.get(
    '/planes',
    autenticado,
    requireRoles(...ROLES_OS_PLAN_LECTURA),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const obraSocial =
          typeof req.query.obra_social === 'string'
            ? req.query.obra_social
            : undefined;
        const plan =
          typeof req.query.plan === 'string' ? req.query.plan : undefined;

        const planes = service.listarPlanes({ obraSocial, plan });
        res.status(200).json(planes);
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /planes
  router.post(
    '/planes',
    autenticado,
    requireRoles(...ROLES_OS_PLAN_GESTION),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const creado = service.crearPlan({
          obra_social: String(body.obra_social ?? ''),
          plan: String(body.plan ?? ''),
          cobertura_pct: Number(body.cobertura_pct),
        });
        res.status(201).json(creado);
      } catch (err) {
        next(err);
      }
    },
  );

  // PATCH /planes/:id
  router.patch(
    '/planes/:id',
    autenticado,
    requireRoles(...ROLES_OS_PLAN_GESTION),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id;
        const body = (req.body ?? {}) as Record<string, unknown>;
        const actualizado = service.actualizarPlan(id, body);
        res.status(200).json(actualizado);
      } catch (err) {
        next(err);
      }
    },
  );

  // DELETE /planes/:id
  router.delete(
    '/planes/:id',
    autenticado,
    requireRoles(...ROLES_OS_PLAN_GESTION),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id;
        service.darDeBaja(id);
        res.status(200).json({ ok: true, id });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
