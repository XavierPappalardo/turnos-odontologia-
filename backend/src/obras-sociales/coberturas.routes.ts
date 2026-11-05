/**
 * Rutas de cobertura de obras sociales (C-12).
 * RBAC: registro/edición para recepcion y administracion.
 * Lectura para todos los roles con profesional acotado a turnos propios.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { getAuth, requireAuth, requireRoles } from '../auth/middleware.js';
import type { AuthConfig, AuthContext } from '../auth/types.js';
import {
  ROLES_OS_COBERTURA_GESTION,
  ROLES_OS_COBERTURA_LECTURA,
  type Rol,
} from '../shared/auth.js';
import { CoberturasService } from './coberturas.service.js';

function rolEfectivo(auth: AuthContext): Rol {
  if (auth.roles.includes('administracion')) return 'administracion';
  if (auth.roles.includes('recepcion')) return 'recepcion';
  return 'profesional';
}

export function coberturasRouter(db: DatabaseSync, config: AuthConfig): Router {
  const router = Router();
  const service = new CoberturasService(db);
  const autenticado = requireAuth(config.jwtSecret, db);

  // POST /coberturas
  router.post(
    '/coberturas',
    autenticado,
    requireRoles(...ROLES_OS_COBERTURA_GESTION),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const creado = service.registrarCobertura(
          (req.body ?? {}) as Parameters<typeof service.registrarCobertura>[0],
        );
        res.status(201).json(creado);
      } catch (err) {
        next(err);
      }
    },
  );

  // PATCH /coberturas/:id
  router.patch(
    '/coberturas/:id',
    autenticado,
    requireRoles(...ROLES_OS_COBERTURA_GESTION),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id;
        const actualizado = service.actualizarMonto(
          id,
          (req.body ?? {}) as Record<string, unknown>,
        );
        res.status(200).json(actualizado);
      } catch (err) {
        next(err);
      }
    },
  );

  // DELETE /coberturas/:id — baja lógica del cargo (habilita re-registro)
  router.delete(
    '/coberturas/:id',
    autenticado,
    requireRoles(...ROLES_OS_COBERTURA_GESTION),
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

  // GET /coberturas
  router.get(
    '/coberturas',
    autenticado,
    requireRoles(...ROLES_OS_COBERTURA_LECTURA),
    (_req: Request, res: Response, next: NextFunction) => {
      try {
        const auth = getAuth(res);
        const rol = rolEfectivo(auth);
        const coberturas = service.listar(
          rol,
          auth.profesionalId ?? null,
        );
        res.status(200).json(coberturas);
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /coberturas/:id
  router.get(
    '/coberturas/:id',
    autenticado,
    requireRoles(...ROLES_OS_COBERTURA_LECTURA),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = req.params.id;
        const auth = getAuth(res);
        const rol = rolEfectivo(auth);
        const cobertura = service.obtenerPorId(
          id,
          rol,
          auth.profesionalId ?? null,
        );
        res.status(200).json(cobertura);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
