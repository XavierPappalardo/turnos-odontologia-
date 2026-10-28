/**
 * Rutas internas de agenda (C-04): crear turno y cambiar estado.
 * Autenticación real de C-03 (JWT + RBAC); recepción/administración operan.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { AuthConfig, AuthContext } from '../auth/types.js';
import { getAuth, requireAuth, requireRoles } from '../auth/middleware.js';
import type { Rol } from '../shared/auth.js';
import { crearTurno } from './crearTurno.service.js';
import { cambiarEstadoTurno } from './turnoEstado.service.js';

const ROLES_AGENDA: readonly Rol[] = ['recepcion', 'administracion'];

function rolEfectivo(auth: AuthContext): Rol | undefined {
  if (auth.roles.includes('administracion')) return 'administracion';
  if (auth.roles.includes('recepcion')) return 'recepcion';
  return auth.roles[0];
}

export function turnosRouter(db: DatabaseSync, config: AuthConfig): Router {
  const router = Router();
  const autenticado = requireAuth(config.jwtSecret);

  router.post(
    '/turnos',
    autenticado,
    requireRoles(...ROLES_AGENDA),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = (req.body ?? {}) as {
          profesional_id?: unknown;
          sillon_id?: unknown;
          paciente_id?: unknown;
          prestacion_id?: unknown;
          inicio?: unknown;
          fin?: unknown;
        };
        const creado = crearTurno(db, {
          profesionalId:
            typeof body.profesional_id === 'string' ? body.profesional_id : '',
          sillonId: typeof body.sillon_id === 'string' ? body.sillon_id : '',
          pacienteId:
            typeof body.paciente_id === 'string' ? body.paciente_id : '',
          prestacionId:
            typeof body.prestacion_id === 'string'
              ? body.prestacion_id
              : undefined,
          inicio: typeof body.inicio === 'string' ? body.inicio : '',
          fin: typeof body.fin === 'string' ? body.fin : '',
          rol: rolEfectivo(getAuth(res)),
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
        next(err);
      }
    },
  );

  router.patch(
    '/turnos/:id/estado',
    autenticado,
    requireRoles(...ROLES_AGENDA),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const turnoId = req.params['id'];
        const body = (req.body ?? {}) as { estado?: unknown };
        if (typeof turnoId !== 'string' || typeof body.estado !== 'string') {
          res.status(400).json({ error: 'validacion' });
          return;
        }
        const actualizado = cambiarEstadoTurno(db, {
          turnoId,
          nuevoEstado: body.estado,
          rol: rolEfectivo(getAuth(res)),
        });
        res.status(200).json({
          id: actualizado.id,
          estado: actualizado.estado,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
