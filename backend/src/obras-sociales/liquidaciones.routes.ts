/**
 * Rutas de liquidaciones de obra social (C-12, F-08).
 * RBAC: ciclo completo exclusivo para administracion (R4, FL-05).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { getAuth, requireAuth, requireRoles } from '../auth/middleware.js';
import type { AuthConfig } from '../auth/types.js';
import { ROLES_OS_LIQUIDACION } from '../shared/auth.js';
import type { LiquidacionOsEstado } from '../shared/types.js';
import { LiquidacionesService } from './liquidaciones.service.js';

export function liquidacionesRouter(
  db: DatabaseSync,
  config: AuthConfig,
): Router {
  const router = Router();
  const service = new LiquidacionesService(db);
  const autenticado = requireAuth(config.jwtSecret, db);

  // POST /liquidaciones
  router.post(
    '/liquidaciones',
    autenticado,
    requireRoles(...ROLES_OS_LIQUIDACION),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const auth = getAuth(res);
        const body = (req.body ?? {}) as {
          obra_social_plan_id: string;
          desde: string;
          hasta: string;
        };
        const resultado = service.generarBorrador(body, auth.userId);
        res.status(201).json(resultado);
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /liquidaciones
  router.get(
    '/liquidaciones',
    autenticado,
    requireRoles(...ROLES_OS_LIQUIDACION),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const planId =
          typeof req.query.obra_social_plan_id === 'string'
            ? req.query.obra_social_plan_id
            : undefined;
        const liquidaciones = service.listar(planId);
        res.status(200).json(liquidaciones);
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /liquidaciones/:id
  router.get(
    '/liquidaciones/:id',
    autenticado,
    requireRoles(...ROLES_OS_LIQUIDACION),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id;
        const detalle = service.obtenerDetalle(id);
        res.status(200).json(detalle);
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /liquidaciones/:id/items
  router.post(
    '/liquidaciones/:id/items',
    autenticado,
    requireRoles(...ROLES_OS_LIQUIDACION),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id;
        const body = (req.body ?? {}) as { cobertura_id: string };
        const item = service.agregarItem(id, body.cobertura_id);
        res.status(200).json(item);
      } catch (err) {
        next(err);
      }
    },
  );

  // DELETE /liquidaciones/:id — baja lógica de cabecera + ítems (misma transacción)
  router.delete(
    '/liquidaciones/:id',
    autenticado,
    requireRoles(...ROLES_OS_LIQUIDACION),
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

  // PATCH /liquidaciones/:id/estado
  router.patch(
    '/liquidaciones/:id/estado',
    autenticado,
    requireRoles(...ROLES_OS_LIQUIDACION),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id;
        const auth = getAuth(res);
        const body = (req.body ?? {}) as { estado: LiquidacionOsEstado };
        const liquidacion = service.transicionarEstado(
          id,
          body.estado,
          auth.userId,
        );
        res.status(200).json(liquidacion);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
