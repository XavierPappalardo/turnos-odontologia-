/**
 * Rutas internas de bloqueos de agenda (C-08, design D7).
 * RBAC: recepción y administración en los cuatro métodos, `GET` incluido
 * (design D6). El mapeo a snake_case vive solo aquí; el servicio no conoce HTTP.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { getAuth, requireAuth, requireRoles } from '../auth/middleware.js';
import type { AuthConfig, AuthContext } from '../auth/types.js';
import { ROLES_BLOQUEOS, type Rol } from '../shared/auth.js';
import { BloqueoError } from '../shared/errors.js';
import type { BloqueoRow } from './bloqueo.repository.js';
import {
  actualizarBloqueo,
  crearBloqueo,
  eliminarBloqueo,
  listarBloqueos,
} from './bloqueo.service.js';
import { normalizarUtc } from './crearTurno.service.js';

function rolEfectivo(auth: AuthContext): Rol | undefined {
  if (auth.roles.includes('administracion')) return 'administracion';
  if (auth.roles.includes('recepcion')) return 'recepcion';
  return auth.roles[0];
}

/** Mapeo único `BloqueoRow → JSON` en snake_case (design D7, task 5.4). */
function bloqueoJson(row: BloqueoRow): Record<string, unknown> {
  return {
    id: row.id,
    profesional_id: row.profesional_id,
    sillon_id: row.sillon_id,
    inicio: row.inicio,
    fin: row.fin,
    motivo: row.motivo,
    deleted_at: row.deleted_at,
  };
}

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** `desde`/`hasta` se normalizan; un valor inválido es 400 (design D7). */
function fechaQuery(
  valor: string | undefined,
  campo: string,
): string | undefined {
  if (valor === undefined) return undefined;
  try {
    return normalizarUtc(valor, campo);
  } catch (err) {
    const detalle =
      err instanceof Error ? err.message : `formato de fecha no UTC en ${campo}`;
    throw new BloqueoError({
      status: 400,
      code: 'validacion',
      message: detalle,
    });
  }
}

/** `undefined` = campo ausente; `null` = globabilidad explícita. */
function idEditable(valor: unknown): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  return typeof valor === 'string' ? valor : '';
}

function idNulable(valor: unknown): string | null {
  if (valor === undefined || valor === null) return null;
  return typeof valor === 'string' ? valor : '';
}

function motivoOpcional(valor: unknown): string | null {
  if (valor === undefined || valor === null) return null;
  return typeof valor === 'string' ? valor : null;
}

function motivoEditable(valor: unknown): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  return typeof valor === 'string' ? valor : null;
}

function fechaEditable(valor: unknown): string | undefined {
  if (valor === undefined) return undefined;
  return typeof valor === 'string' ? valor : '';
}

export function bloqueosRouter(
  db: DatabaseSync,
  config: AuthConfig,
): Router {
  const router = Router();
  const autenticado = requireAuth(config.jwtSecret, db);

  router.post(
    '/bloqueos',
    autenticado,
    requireRoles(...ROLES_BLOQUEOS),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const creado = crearBloqueo(db, {
          profesionalId: idNulable(body['profesional_id']),
          sillonId: idNulable(body['sillon_id']),
          inicio: typeof body['inicio'] === 'string' ? body['inicio'] : '',
          fin: typeof body['fin'] === 'string' ? body['fin'] : '',
          motivo: motivoOpcional(body['motivo']),
          rol: rolEfectivo(getAuth(res)),
        });
        res.status(201).json({
          id: creado.id,
          profesional_id: creado.profesionalId,
          sillon_id: creado.sillonId,
          inicio: creado.inicio,
          fin: creado.fin,
          motivo: creado.motivo,
          deleted_at: null,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/bloqueos',
    autenticado,
    requireRoles(...ROLES_BLOQUEOS),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const filas = listarBloqueos(db, {
          profesionalId: queryString(req.query['profesional_id']),
          sillonId: queryString(req.query['sillon_id']),
          desde: fechaQuery(queryString(req.query['desde']), 'desde'),
          hasta: fechaQuery(queryString(req.query['hasta']), 'hasta'),
        });
        res.status(200).json({ bloqueos: filas.map(bloqueoJson) });
      } catch (err) {
        next(err);
      }
    },
  );

  router.put(
    '/bloqueos/:id',
    autenticado,
    requireRoles(...ROLES_BLOQUEOS),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const actualizado = actualizarBloqueo(db, {
          id: req.params['id'],
          profesionalId: idEditable(body['profesional_id']),
          sillonId: idEditable(body['sillon_id']),
          inicio: fechaEditable(body['inicio']),
          fin: fechaEditable(body['fin']),
          motivo: motivoEditable(body['motivo']),
          rol: rolEfectivo(getAuth(res)),
        });
        res.status(200).json(bloqueoJson(actualizado));
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/bloqueos/:id',
    autenticado,
    requireRoles(...ROLES_BLOQUEOS),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        eliminarBloqueo(db, {
          id: req.params['id'],
          rol: rolEfectivo(getAuth(res)),
        });
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
