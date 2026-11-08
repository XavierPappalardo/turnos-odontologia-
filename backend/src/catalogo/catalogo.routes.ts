/**
 * Rutas de catálogo de prestaciones y tarifas (C-15).
 * - Públicas (/api/public/prestaciones): sin JWT para soporte de reserva online y precios abiertos en ARS (F-12/RN-12).
 * - Privadas (/api/prestaciones): consulta para recepción/profesional/admin y actualización exclusiva de administración (RBAC).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { requireAuth, requireRoles } from '../auth/middleware.js';
import type { AuthConfig } from '../auth/types.js';
import { AppError } from '../shared/errors.js';
import { CatalogoService } from './catalogo.service.js';

export function catalogoPublicoRouter(db: DatabaseSync): Router {
  const router = Router();
  const service = new CatalogoService(db);

  router.get(
    '/prestaciones',
    (_req: Request, res: Response, next: NextFunction) => {
      try {
        const prestaciones = service.listarPrestacionesPublicas();
        res.status(200).json(prestaciones);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

export function catalogoRouter(db: DatabaseSync, config: AuthConfig): Router {
  const router = Router();
  const service = new CatalogoService(db);
  const auth = requireAuth(config.jwtSecret, db);

  router.get(
    '/prestaciones',
    auth,
    requireRoles('recepcion', 'profesional', 'administracion'),
    (_req: Request, res: Response, next: NextFunction) => {
      try {
        const prestaciones = service.listarPrestacionesInternas();
        res.status(200).json(prestaciones);
      } catch (err) {
        next(err);
      }
    },
  );

  router.put(
    '/prestaciones/:id/precio',
    auth,
    requireRoles('administracion'),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = (req.body ?? {}) as { precio_base_centavos?: unknown };
        const precioBaseCentavos = body.precio_base_centavos;

        if (
          typeof precioBaseCentavos !== 'number' ||
          !Number.isInteger(precioBaseCentavos) ||
          precioBaseCentavos < 0
        ) {
          throw new AppError({
            status: 400,
            code: 'validacion',
            message: 'precio_base_centavos debe ser un entero no negativo',
          });
        }

        const actualizada = service.actualizarPrecio(
          req.params.id,
          precioBaseCentavos,
        );
        res.status(200).json(actualizada);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
