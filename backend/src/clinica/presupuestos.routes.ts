/**
 * Task 5.1/5.2: Rutas de presupuestos (C-10).
 * GET/POST/PATCH/DELETE /api/presupuestos
 * GET/POST /api/pacientes/:pacienteId/presupuestos
 * POST /api/presupuestos/:id/transicion
 * POST /api/presupuestos/:id/items
 * PATCH /api/presupuestos/:id/items/:itemId
 * DELETE /api/presupuestos/:id/items/:itemId
 *
 * Autorización clínica (Task 5.2):
 * - Ítems vinculados al odontograma (pieza_fdi != null): solo `profesional`
 *   con profesionalId resuelto; `recepcion`/`administracion` reciben 403.
 * - Operaciones de CRUD de presupuesto: cualquier rol autenticado.
 * Errores tipados sin PHI (R3).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { PresupuestoService } from './presupuestos.service.js';
import type {
  PacienteId,
  PresupuestoId,
  TurnoId,
  ItemPresupuestoId,
  PresupuestoEstado,
} from '../shared/types.js';

export function presupuestosRouter(db: DatabaseSync): Router {
  const router = Router();
  const svc = new PresupuestoService(db);

  // ── Helper: respuesta de error tipada sin PHI ──
  function handleError(err: unknown, res: Response, next: NextFunction): void {
    const e = err as { status?: number; code?: string };
    if (e.status) {
      res.status(e.status).json({ error: e.code ?? 'error' });
    } else {
      next(err);
    }
  }

  // ── Helper: verifica que el usuario tiene profesionalId (acceso clínico) ──
  function requireProfesional(res: Response): string | null {
    const auth = res.locals.auth as { profesionalId?: string } | undefined;
    return auth?.profesionalId ?? null;
  }

  // ── GET /api/pacientes/:pacienteId/presupuestos ──
  // Lista todos los presupuestos de un paciente. Cualquier rol autenticado.
  router.get(
    '/pacientes/:pacienteId/presupuestos',
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const lista = svc.listarPorPaciente(req.params.pacienteId as PacienteId);
        res.status(200).json(lista);
      } catch (err) {
        handleError(err, res, next);
      }
    },
  );

  // ── POST /api/pacientes/:pacienteId/presupuestos ──
  // Crea un presupuesto (turno_id NULLABLE). Cualquier rol autenticado.
  router.post(
    '/pacientes/:pacienteId/presupuestos',
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const body = req.body as {
          turno_id?: string | null | undefined;
          total_centavos?: number | undefined;
        };
        const input: {
          pacienteId: PacienteId;
          turnoId: TurnoId | null;
          total_centavos?: number | undefined;
        } = {
          pacienteId: req.params.pacienteId as PacienteId,
          turnoId: (body.turno_id ?? null) as TurnoId | null,
        };
        if (body.total_centavos !== undefined) {
          input.total_centavos = body.total_centavos;
        }
        const presupuesto = svc.crearPresupuesto(input);
        res.status(201).json(presupuesto);
      } catch (err) {
        handleError(err, res, next);
      }
    },
  );

  // ── GET /api/presupuestos/:id ──
  router.get(
    '/presupuestos/:id',
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const presupuesto = svc.obtenerPresupuesto(req.params.id as PresupuestoId);
        res.status(200).json(presupuesto);
      } catch (err) {
        handleError(err, res, next);
      }
    },
  );

  // ── PATCH /api/presupuestos/:id ──
  // Edición solo en estado borrador.
  router.patch(
    '/presupuestos/:id',
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const body = req.body as {
          total_centavos?: number | undefined;
          obra_social_plan_id?: string | null | undefined;
        };
        const cambios: {
          total_centavos?: number | undefined;
          obra_social_plan_id?: any;
        } = {};
        if (body.total_centavos !== undefined) {
          cambios.total_centavos = body.total_centavos;
        }
        if (body.obra_social_plan_id !== undefined) {
          cambios.obra_social_plan_id = body.obra_social_plan_id;
        }
        const actualizado = svc.editarPresupuesto(req.params.id as PresupuestoId, cambios);
        res.status(200).json(actualizado);
      } catch (err) {
        handleError(err, res, next);
      }
    },
  );

  // ── DELETE /api/presupuestos/:id ──
  router.delete(
    '/presupuestos/:id',
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        svc.eliminarPresupuesto(req.params.id as PresupuestoId);
        res.status(204).send();
      } catch (err) {
        handleError(err, res, next);
      }
    },
  );

  // ── POST /api/presupuestos/:id/transicion ──
  // Transición de estado: borrador→enviado→aceptado|rechazado|vencido.
  router.post(
    '/presupuestos/:id/transicion',
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const body = req.body as { estado?: string };
        if (!body.estado) {
          res.status(400).json({ error: 'estado_requerido' });
          return;
        }
        const resultado = svc.transicionarEstado(
          req.params.id as PresupuestoId,
          body.estado as PresupuestoEstado,
        );
        res.status(200).json(resultado);
      } catch (err) {
        handleError(err, res, next);
      }
    },
  );

  // ── POST /api/presupuestos/:id/items ──
  // Agrega un ítem. Si el ítem vincula al odontograma (pieza_fdi != null),
  // requiere `profesional` con profesionalId resuelto (Task 5.2).
  router.post(
    '/presupuestos/:id/items',
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const body = req.body as {
          descripcion?: string;
          monto_centavos?: number;
          pieza_fdi?: number | null;
          superficie?: string | null;
        };

        // Autorización clínica: si el ítem vincula al odontograma,
        // solo profesional con acceso puede crear (Task 5.2 / spec clinica/acceso-hc).
        if (body.pieza_fdi !== null && body.pieza_fdi !== undefined) {
          const profesionalId = requireProfesional(res);
          if (!profesionalId) {
            res.status(403).json({ error: 'forbidden' });
            return;
          }
        }

        const item = svc.agregarItem(req.params.id as PresupuestoId, {
          descripcion: body.descripcion ?? '',
          monto_centavos: body.monto_centavos ?? 0,
          pieza_fdi: body.pieza_fdi ?? null,
          superficie: body.superficie ?? null,
        });
        res.status(201).json(item);
      } catch (err) {
        handleError(err, res, next);
      }
    },
  );

  // ── PATCH /api/presupuestos/:id/items/:itemId ──
  router.patch(
    '/presupuestos/:id/items/:itemId',
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const body = req.body as {
          descripcion?: string | undefined;
          monto_centavos?: number | undefined;
          pieza_fdi?: number | null | undefined;
          superficie?: string | null | undefined;
        };

        // Autorización clínica si se vincula al odontograma
        if (body.pieza_fdi !== null && body.pieza_fdi !== undefined) {
          const profesionalId = requireProfesional(res);
          if (!profesionalId) {
            res.status(403).json({ error: 'forbidden' });
            return;
          }
        }

        const cambiosItem: {
          descripcion?: string | undefined;
          monto_centavos?: number | undefined;
          pieza_fdi?: number | null | undefined;
          superficie?: string | null | undefined;
        } = {};
        if (body.descripcion !== undefined) cambiosItem.descripcion = body.descripcion;
        if (body.monto_centavos !== undefined) cambiosItem.monto_centavos = body.monto_centavos;
        if (body.pieza_fdi !== undefined) cambiosItem.pieza_fdi = body.pieza_fdi;
        if (body.superficie !== undefined) cambiosItem.superficie = body.superficie;

        const item = svc.editarItem(req.params.itemId as ItemPresupuestoId, cambiosItem);
        res.status(200).json(item);
      } catch (err) {
        handleError(err, res, next);
      }
    },
  );

  // ── DELETE /api/presupuestos/:id/items/:itemId ──
  router.delete(
    '/presupuestos/:id/items/:itemId',
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        svc.eliminarItem(req.params.itemId as ItemPresupuestoId);
        res.status(204).send();
      } catch (err) {
        handleError(err, res, next);
      }
    },
  );

  return router;
}
