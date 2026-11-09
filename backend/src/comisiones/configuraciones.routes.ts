/**
 * Rutas de configuración de comisiones (C-13, task 6.1).
 * RBAC: solo `administracion` configura y consulta (R4; design D6 —
 * `ROLES_COM_CONFIG`). Patrón C-11/C-12: middleware `requireAuth` +
 * `requireRoles`, handler con try/catch → `next(err)` y error-handler central.
 * Cuerpo con forma mínima EXIGIDA (policy del patrón caja/cobros): la validación
 * de dominio (0..100, FK, duplicados) vive en el servicio (5.1).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { getAuth, requireAuth, requireRoles } from '../auth/middleware.js';
import type { AuthConfig } from '../auth/types.js';
import { ROLES_COM_CONFIG } from '../shared/auth.js';
import { ComisionError } from '../shared/errors.js';
import {
  ComisionesConfigService,
  type GuardarConfiguracionInput,
} from './configuraciones.service.js';

/** Cuerpo del PUT con forma estructural mínima (malformed body → 422). */
interface ConfigBody {
  pct_general?: unknown;
  tratamientos?: unknown;
}

/** Rechaza cuerpos con fields ausentes/ilegibles ANTES del servicio (422). */
function exigirCuerpoConfiguracion(body: ConfigBody): GuardarConfiguracionInput {
  const { pct_general, tratamientos } = body;
  if (typeof pct_general !== 'number') {
    throw new ComisionError({
      status: 422,
      code: 'validacion',
      message: 'cuerpo inválido',
      detalle: 'pct_general requerido (numérico)',
    });
  }
  if (!Array.isArray(tratamientos)) {
    throw new ComisionError({
      status: 422,
      code: 'validacion',
      message: 'cuerpo inválido',
      detalle: 'tratamientos requerido (array)',
    });
  }
  for (const tratamiento of tratamientos) {
    const fila = tratamiento as Record<string, unknown>;
    if (
      typeof fila !== 'object' ||
      fila === null ||
      typeof fila['prestacion_id'] !== 'string' ||
      typeof fila['pct'] !== 'number'
    ) {
      throw new ComisionError({
        status: 422,
        code: 'validacion',
        message: 'cuerpo inválido',
        detalle:
          'cada tratamiento debe ser { prestacion_id: string, pct: number }',
      });
    }
  }
  return {
    profesional_id: '',
    pct_general: pct_general,
    tratamientos: tratamientos.map((t) => t as GuardarConfiguracionInput['tratamientos'][number]),
  };
}

export function configuracionesRouter(
  db: DatabaseSync,
  config: AuthConfig,
): Router {
  const router = Router();
  const service = new ComisionesConfigService(db);
  const autenticado = requireAuth(config.jwtSecret, db);
  const administracion = requireRoles(...ROLES_COM_CONFIG);

  // PUT /configuraciones/:profesionalId — upsert idempotente (task 5.1).
  router.put(
    '/configuraciones/:profesionalId',
    autenticado,
    administracion,
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const input = exigirCuerpoConfiguracion((req.body ?? {}) as ConfigBody);
        input.profesional_id = String(req.params.profesionalId);
        const estado = service.guardarConfiguracion(input);
        res.status(200).json(estado);
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /configuraciones/:profesionalId — lectura tolerante ({config: null}).
  router.get(
    '/configuraciones/:profesionalId',
    autenticado,
    administracion,
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const estado = service.obtenerConfiguracion(String(req.params.profesionalId));
        res.status(200).json(estado);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
