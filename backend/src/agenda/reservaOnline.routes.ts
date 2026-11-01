/**
 * Rutas públicas de reserva online (C-05): sin autenticación JWT.
 * Reutilizan la lógica de solape y bloqueos de C-04. Rate limiting por IP.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { reservarTurnoOnline, type ReservaOnlineInput } from './reservaOnline.service.js';
import { TurnoRepository } from './turno.repository.js';
import { BloqueoRepository } from './bloqueo.repository.js';
import { PublicRateLimiter, publicRateLimiterMiddleware } from './publicRateLimiter.js';
import type { AppConfig } from '../shared/config.js';
import type { ProfesionalId, SillonId } from '../shared/types.js';

const HORA_INICIO_LABORAL = 8; // 08:00
const HORA_FIN_LABORAL = 18; // 18:00
const DURACION_HUECO_MIN = 30;

function generarHuecos(fecha: string): string[] {
  const huecos: string[] = [];
  const base = new Date(`${fecha}T00:00:00.000Z`);
  for (let h = HORA_INICIO_LABORAL; h < HORA_FIN_LABORAL; h++) {
    for (let m = 0; m < 60; m += DURACION_HUECO_MIN) {
      const d = new Date(base);
      d.setUTCHours(h, m, 0, 0);
      huecos.push(d.toISOString());
    }
  }
  return huecos;
}

function horaFin(inicio: string, duracionMin: number): string {
  const d = new Date(inicio);
  d.setUTCMinutes(d.getUTCMinutes() + duracionMin);
  return d.toISOString();
}

export function reservaOnlineRouter(
  db: DatabaseSync,
  config: AppConfig,
): Router {
  const router = Router();
  const limiter = new PublicRateLimiter({
    max: config.reservaOnline.rateMax,
    windowSeconds: config.reservaOnline.rateWindowSeconds,
  });
  const rateLimit = publicRateLimiterMiddleware(limiter);
  const turnos = new TurnoRepository(db);
  const bloqueos = new BloqueoRepository(db);

  router.use(rateLimit);

  router.post(
    '/turnos',
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
        const input: ReservaOnlineInput = {
          profesionalId: typeof body.profesional_id === 'string' ? body.profesional_id : '',
          sillonId: typeof body.sillon_id === 'string' ? body.sillon_id : '',
          pacienteId: typeof body.paciente_id === 'string' ? body.paciente_id : '',
          prestacionId: typeof body.prestacion_id === 'string' ? body.prestacion_id : undefined,
          inicio: typeof body.inicio === 'string' ? body.inicio : '',
          fin: typeof body.fin === 'string' ? body.fin : '',
        };
        const creado = reservarTurnoOnline(db, input, config.reservaOnline.anticipacionMinSegundos);
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

  router.get(
    '/agenda/disponibilidad',
    (_req: Request, res: Response, next: NextFunction) => {
      try {
        const query = _req.query as {
          profesional_id?: string;
          sillon_id?: string;
          fecha?: string;
        };
        const profesionalId = query.profesional_id ?? '';
        const sillonId = query.sillon_id ?? '';
        const fecha = query.fecha ?? '';

        if (profesionalId === '' || sillonId === '' || fecha === '') {
          res.status(400).json({ error: 'validacion', detalle: 'campos obligatorios faltantes' });
          return;
        }

        const profesionalIdTyped = profesionalId as ProfesionalId;
        const sillonIdTyped = sillonId as SillonId;

        const huecos = generarHuecos(fecha);
        const libres: string[] = [];
        for (const inicio of huecos) {
          const fin = horaFin(inicio, DURACION_HUECO_MIN);
          const solapeProf = turnos.existeSolapeProfesional(profesionalIdTyped, inicio, fin);
          const solapeSillon = turnos.existeSolapeSillon(sillonIdTyped, inicio, fin);
          const bloqueo = bloqueos.existeBloqueoAplicable(profesionalIdTyped, sillonIdTyped, inicio, fin);
          if (!solapeProf && !solapeSillon && !bloqueo) {
            libres.push(inicio);
          }
        }
        res.status(200).json({ profesional_id: profesionalIdTyped, sillon_id: sillonIdTyped, fecha, huecos_libres: libres });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
