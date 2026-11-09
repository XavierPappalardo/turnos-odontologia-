/**
 * Rutas de liquidaciones de comisiones (C-13, task 6.1).
 * RBAC (design D6, matriz testada en comisiones_auth): gestion — solo
 * `administracion` (`ROLES_COM_GESTION`); portal profesional —
 * `GET /mis-liquidaciones` exclusivo del rol `profesional` con scoping
 * FORZADO por `usuario.profesional_id` resuelto del token (Q6: solo
 * confirmadas) y `GET /liquidaciones/:id` con restricción propia confirmada
 * (ajena o borrador propia → 404 sin exposición de montos, R3). Patrón
 * C-11/C-12: `requireAuth`/`requireRoles`, try/catch → `next(err)`, error
 * mapper central (`ComisionError.toBody`), `fingerprint` exigido en body
 * (D13) para generar/regenerar/confirmar y actor desde el JWT.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { getAuth, requireAuth, requireRoles } from '../auth/middleware.js';
import type { AuthConfig } from '../auth/types.js';
import { ROLES_COM_GESTION } from '../shared/auth.js';
import { ComisionError } from '../shared/errors.js';
import { ComisionesLiquidacionesService } from './liquidaciones.service.js';

/** Cuerpo mínimo estructural: campo string no vacío (malformed → 422). */
function exigirCuerpoString(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new ComisionError({
      status: 422,
      code: 'validacion',
      message: 'cuerpo inválido',
      detalle: `${campo} requerido (string)`,
    });
  }
  return valor;
}

export function liquidacionesRouter(
  db: DatabaseSync,
  config: AuthConfig,
): Router {
  const router = Router();
  const service = new ComisionesLiquidacionesService(db);
  const autenticado = requireAuth(config.jwtSecret, db);
  const administracion = requireRoles(...ROLES_COM_GESTION);

  // POST /preview — cálculo vivo sin persistencia; responde fingerprint (D13).
  router.post(
    '/preview',
    autenticado,
    administracion,
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const resumen = service.calcularPreview(
          exigirCuerpoString(body.profesional_id, 'profesional_id'),
          exigirCuerpoString(body.desde, 'desde'),
          exigirCuerpoString(body.hasta, 'hasta'),
        );
        res.status(200).json(resumen);
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /liquidaciones — genera borrador; fingerprint EXIGIDO en body (D13).
  router.post(
    '/liquidaciones',
    autenticado,
    administracion,
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const borrador = service.generarBorrador({
          profesionalId: exigirCuerpoString(body.profesional_id, 'profesional_id'),
          desde: exigirCuerpoString(body.desde, 'desde'),
          hasta: exigirCuerpoString(body.hasta, 'hasta'),
          fingerprint: exigirCuerpoString(body.fingerprint, 'fingerprint'),
          actorUsuarioId: getAuth(res).userId,
        });
        res.status(201).json(borrador);
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /liquidaciones/:id/regenerar — baja + recálculo completo; fp en body.
  router.post(
    '/liquidaciones/:id/regenerar',
    autenticado,
    administracion,
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const borrador = service.regenerarBorrador({
          liquidacionId: String(req.params.id),
          fingerprint: exigirCuerpoString(body.fingerprint, 'fingerprint'),
        });
        res.status(200).json(borrador);
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /liquidaciones/:id/confirmar — transición única con fp en body (D5/D13).
  router.post(
    '/liquidaciones/:id/confirmar',
    autenticado,
    administracion,
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const borrador = service.confirmarBorrador({
          liquidacionId: String(req.params.id),
          fingerprint: exigirCuerpoString(body.fingerprint, 'fingerprint'),
          actorUsuarioId: getAuth(res).userId,
        });
        res.status(200).json(borrador);
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /liquidaciones — listado para administración (todas las vigentes).
  router.get(
    '/liquidaciones',
    autenticado,
    administracion,
    (_req: Request, res: Response, next: NextFunction) => {
      try {
        res.status(200).json(service.listarTodas());
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /liquidaciones/:id — administración: detalle completo; profesional:
  // SOLO su propia confirmada (ajena/borrador → 404 sin montos, R3/Q6);
  // resto de roles → 403 (R4).
  router.get(
    '/liquidaciones/:id',
    autenticado,
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const auth = getAuth(res);
        const id = String(req.params.id);
        if (auth.roles.includes('administracion')) {
          res.status(200).json(service.obtenerDetalle(id));
          return;
        }
        if (auth.roles.includes('profesional')) {
          const propio =
            auth.profesionalId === undefined
              ? undefined
              : service.obtenerConfirmadaPropia(id, auth.profesionalId);
          if (propio === undefined) {
            res.status(404).json({ error: 'not_found' });
            return;
          }
          res.status(200).json(propio);
          return;
        }
        res.status(403).json({ error: 'forbidden' });
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /mis-liquidaciones — portal del profesional (Q6): scoping forzado por
  // usuario.profesional_id del token; SOLO confirmadas; sin vínculo → [].
  router.get(
    '/mis-liquidaciones',
    autenticado,
    requireRoles('profesional'),
    (_req: Request, res: Response, next: NextFunction) => {
      try {
        res.status(200).json(service.listarConfirmadasDe(getAuth(res).profesionalId));
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
