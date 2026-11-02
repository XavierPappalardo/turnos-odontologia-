/**
 * C-09 task 8.2: Rutas de datos clínicos del paciente.
 * `PATCH /api/pacientes/:id` - allowlist de campos clínicos por rol.
 * Autenticación y `profesional_id` resueltos por middleware previo.
 * Errores tipados sin PHI (R3).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { PacienteService } from '../core/paciente.service.js';

export function pacientesRouter(db: DatabaseSync): Router {
  const router = Router();
  const svc = new PacienteService(db);

  router.patch(
    '/pacientes/:id',
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const auth = res.locals.auth as {
          profesionalId: string | null;
          roles: readonly string[];
        } | undefined;
        if (!auth) {
          res.status(401).json({ error: 'no_autenticado' });
          return;
        }
        const body = req.body as Record<string, unknown>;
        const resultado = svc.actualizarDatosClinicos(
          req.params.id,
          body,
          auth.profesionalId,
          auth.roles,
        );
        if (resultado.tipo === 'not_found') {
          res.status(404).json({ error: 'paciente_no_encontrado' });
          return;
        }
        if (resultado.tipo === 'forbidden') {
          res.status(403).json({ error: 'rol_no_autorizado_para_campo' });
          return;
        }
        if (resultado.tipo === 'validacion') {
          res.status(400).json({ error: 'validacion' });
          return;
        }
        res.status(200).json(resultado.data);
      } catch (err: any) {
        if (err.status) {
          res.status(err.status).json({ error: err.code });
        } else {
          next(err);
        }
      }
    },
  );

  return router;
}
