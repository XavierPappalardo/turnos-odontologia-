/**
 * C-09 task 7.4: Rutas de odontograma.
 * `GET /api/pacientes/:id/odontograma` (estado actual),
 * `GET /api/pacientes/:id/odontograma/historial?pieza=` (historial),
 * `POST /api/pacientes/:id/odontograma/eventos` (alta),
 * `POST .../eventos/:eventoId/enmiendas` (enmienda).
 * Autenticación y `profesional_id` resueltos por middleware previo.
 * Errores tipados sin PHI (R3).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { esPiezaFdiValida } from './fdi.js';
import { OdontogramaService } from './odontograma.service.js';

export function odontogramaRouter(db: DatabaseSync): Router {
  const router = Router();
  const svc = new OdontogramaService(db);

  router.get(
    '/pacientes/:id/odontograma',
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const auth = res.locals.auth as { profesionalId: string | null } | undefined;
        if (!auth?.profesionalId) {
          res.status(403).json({ error: 'sin_vinculo' });
          return;
        }
        const piezas = svc.estadoActual(req.params.id);
        res.status(200).json({ paciente_id: req.params.id, piezas });
      } catch (err: any) {
        if (err.status) {
          res.status(err.status).json({ error: err.code });
        } else {
          next(err);
        }
      }
    },
  );

  router.get(
    '/pacientes/:id/odontograma/historial',
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const auth = res.locals.auth as { profesionalId: string | null } | undefined;
        if (!auth?.profesionalId) {
          res.status(403).json({ error: 'sin_vinculo' });
          return;
        }
        const piezaParam = req.query.pieza;
        if (piezaParam === undefined) {
          res.status(400).json({ error: 'pieza_requerida' });
          return;
        }
        const piezaFdi = Number(piezaParam);
        if (!Number.isInteger(piezaFdi) || !esPiezaFdiValida(piezaFdi)) {
          res.status(400).json({ error: 'pieza_invalida' });
          return;
        }
        const historial = svc.historialPorPieza(req.params.id, piezaFdi);
        res.status(200).json({ pieza: piezaFdi, eventos: historial });
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
    '/pacientes/:id/odontograma/eventos',
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const auth = res.locals.auth as { profesionalId: string | null } | undefined;
        if (!auth?.profesionalId) {
          res.status(403).json({ error: 'sin_vinculo' });
          return;
        }
        const body = req.body as {
          pieza?: number;
          superficie?: string;
          hallazgo?: string;
          ocurrido_en?: string;
          turno_id?: string | null;
        };
        const evt = svc.registrarEvento({
          pacienteId: req.params.id,
          pieza: body.pieza ?? 0,
          superficie: body.superficie ?? '',
          hallazgo: body.hallazgo ?? '',
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

  router.post(
    '/pacientes/:id/odontograma/eventos/:eventoId/enmiendas',
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const auth = res.locals.auth as { profesionalId: string | null } | undefined;
        if (!auth?.profesionalId) {
          res.status(403).json({ error: 'sin_vinculo' });
          return;
        }
        const body = req.body as {
          pieza?: number;
          superficie?: string;
          hallazgo?: string;
          motivo_enmienda?: string;
        };
        const evt = svc.enmendarEvento({
          pacienteId: req.params.id,
          eventoId: req.params.eventoId,
          pieza: body.pieza ?? 0,
          superficie: body.superficie ?? '',
          hallazgo: body.hallazgo ?? '',
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
