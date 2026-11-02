/**
 * C-09 task 6.5: Rutas de historia clínica.
 * `GET/POST /api/pacientes/:id/historia-clinica(/eventos)` y
 * `POST .../eventos/:eventoId/enmiendas`.
 * Autenticación y `profesional_id` resueltos por middleware previo
 * (`requireAuth` + `resolverProfesional`).
 * Errores tipados sin PHI (R3).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { HistoriaClinicaService } from './historiaClinica.service.js';

export function historiaClinicaRouter(db: DatabaseSync): Router {
  const router = Router();
  const svc = new HistoriaClinicaService(db);

  router.post(
    '/pacientes/:id/historia-clinica/eventos',
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const auth = res.locals.auth as { profesionalId: string | null } | undefined;
        if (!auth?.profesionalId) {
          res.status(403).json({ error: 'sin_vinculo' });
          return;
        }
        const body = req.body as {
          tipo?: string;
          detalle?: string;
          ocurrido_en?: string;
          turno_id?: string | null;
        };
        const evt = svc.registrarEvento({
          pacienteId: req.params.id,
          tipo: (body.tipo ?? '') as any,
          detalle: body.detalle ?? '',
          ocurridoEn: body.ocurrido_en ?? '',
          actorUsuarioId: (res.locals.auth as { userId: string }).userId,
          profesionalId: auth.profesionalId,
          turnoId: body.turno_id ?? null,
        });
        res.status(201).json(evt);
      } catch (err: any) {
        if (err.status) {
          res.status(err.status).json({ error: err.code, motivo: err.motivo });
        } else {
          next(err);
        }
      }
    },
  );

  router.get(
    '/pacientes/:id/historia-clinica',
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const auth = res.locals.auth as { profesionalId: string | null; userId: string; roles: readonly string[] } | undefined;
        if (!auth?.profesionalId) {
          res.status(403).json({ error: 'sin_vinculo' });
          return;
        }
        const eventos = svc.listarPorPaciente(
          req.params.id,
          req.query.turno_id as string | undefined,
          auth.userId,
          auth.roles[0] ?? null,
        );
        res.status(200).json({ paciente_id: req.params.id, eventos });
      } catch (err: any) {
        if (err.status) {
          res.status(err.status).json({ error: err.code });
        } else {
          next(err);
        }
      }
    },
  );

  router.post(
    '/pacientes/:id/historia-clinica/eventos/:eventoId/enmiendas',
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const auth = res.locals.auth as { profesionalId: string | null } | undefined;
        if (!auth?.profesionalId) {
          res.status(403).json({ error: 'sin_vinculo' });
          return;
        }
        const body = req.body as {
          tipo?: string;
          detalle?: string;
          motivo_enmienda?: string;
        };
        const evt = svc.enmendarEvento({
          pacienteId: req.params.id,
          eventoId: req.params.eventoId,
          tipo: (body.tipo ?? '') as any,
          detalle: body.detalle ?? '',
          motivoEnmienda: body.motivo_enmienda ?? '',
          actorUsuarioId: (res.locals.auth as { userId: string }).userId,
          profesionalId: auth.profesionalId,
        });
        res.status(201).json(evt);
      } catch (err: any) {
        if (err.status) {
          res.status(err.status).json({ error: err.code, motivo: err.motivo });
        } else {
          next(err);
        }
      }
    },
  );

  return router;
}
