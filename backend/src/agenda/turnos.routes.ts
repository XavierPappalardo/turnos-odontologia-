/**
 * POST /api/turnos — creación interna de turno (spec agenda/crear-turno).
 * Auth C-03 [Supuesto]: middleware RBAC stub (header x-role).
 */
import { Router, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { extraerRol } from '../shared/auth.js';
import { CrearTurnoError } from '../shared/errors.js';
import { crearTurno } from './crearTurno.service.js';

export function turnosRouter(db: DatabaseSync): Router {
  const router = Router();

  router.post('/turnos', (req: Request, res: Response) => {
    try {
      const body = req.body as {
        profesional_id?: unknown;
        sillon_id?: unknown;
        paciente_id?: unknown;
        prestacion_id?: unknown;
        inicio?: unknown;
        fin?: unknown;
      };
      const creado = crearTurno(db, {
        profesionalId: typeof body.profesional_id === 'string' ? body.profesional_id : '',
        sillonId: typeof body.sillon_id === 'string' ? body.sillon_id : '',
        pacienteId: typeof body.paciente_id === 'string' ? body.paciente_id : '',
        prestacionId:
          typeof body.prestacion_id === 'string' ? body.prestacion_id : undefined,
        inicio: typeof body.inicio === 'string' ? body.inicio : '',
        fin: typeof body.fin === 'string' ? body.fin : '',
        rol: extraerRol(req),
      });
      res.status(201).json({
        id: creado.id,
        profesional_id: creado.profesionalId,
        sillon_id: creado.sillonId,
        paciente_id: creado.pacienteId,
        inicio: creado.inicio,
        fin: creado.fin,
        estado: creado.estado,
        origen: creado.origen,
      });
    } catch (err) {
      if (err instanceof CrearTurnoError) {
        res.status(err.status).json(err.toBody());
        return;
      }
      res.status(500).json({ error: 'interno' });
    }
  });

  return router;
}
