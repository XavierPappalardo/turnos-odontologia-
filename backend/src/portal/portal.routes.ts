/**
 * API del portal paciente (C-17). Acceso por token opaco (header/query), sin PHI en logs.
 * Endpoints: mis turnos, mis presupuestos, documentos (MVP vacío seguro), acciones turno propias.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../shared/config.js';
import { PublicRateLimiter, publicRateLimiterMiddleware } from '../agenda/publicRateLimiter.js';
import { PortalAccesoService } from './portalAcceso.service.js';
import { PortalConsultaRepository } from './portalConsulta.repository.js';
import { ejecutarAccionPortalTurno, type AccionPortalTurno } from './portalAccionTurno.service.js';

function extraerToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const hdr = req.headers['x-portal-token'];
  if (typeof hdr === 'string') return hdr.trim();
  if (typeof req.query.token === 'string') return req.query.token;
  return undefined;
}

export function portalPacienteRouter(db: DatabaseSync, config: AppConfig): Router {
  const router = Router();
  const limiter = new PublicRateLimiter({
    max: config.portalPaciente.rateMax,
    windowSeconds: config.portalPaciente.rateWindowSeconds,
  });
  router.use(publicRateLimiterMiddleware(limiter));

  const acceso = new PortalAccesoService(db);
  const consultas = new PortalConsultaRepository(db);

  function requirePortal(req: Request, res: Response, next: NextFunction): void {
    try {
      const ctx = acceso.validar(extraerToken(req));
      res.locals.portal = ctx;
      next();
    } catch (err) {
      next(err);
    }
  }

  router.get('/portal/turnos', requirePortal, (_req: Request, res: Response) => {
    const ctx = res.locals.portal as { pacienteId: string };
    res.status(200).json({ turnos: consultas.listarTurnos(ctx.pacienteId) });
  });

  router.get('/portal/presupuestos', requirePortal, (_req: Request, res: Response) => {
    const ctx = res.locals.portal as { pacienteId: string };
    res.status(200).json({ presupuestos: consultas.listarPresupuestos(ctx.pacienteId) });
  });
  // Rechazo explícito de mutaciones de presupuesto desde portal (read-only).
  router.use('/portal/presupuestos', requirePortal, (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET') return next();
    res.status(403).json({ error: 'forbidden' });
  });

  router.get('/portal/documentos', requirePortal, (_req: Request, res: Response) => {
    // MVP: sin repositorio documental; contrato seguro/extensible.
    res.status(200).json({ documentos: [] });
  });

  function accion(accion: AccionPortalTurno) {
    return (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = res.locals.portal as { pacienteId: string };
        const body = (req.body ?? {}) as { nuevo_inicio?: string; nuevo_fin?: string };
        const input: { pacienteId: string; turnoId: string; accion: AccionPortalTurno; nuevoInicio?: string; nuevoFin?: string } = {
          pacienteId: ctx.pacienteId,
          turnoId: req.params['id'] as string,
          accion,
        };
        if (typeof body.nuevo_inicio === 'string') input.nuevoInicio = body.nuevo_inicio;
        if (typeof body.nuevo_fin === 'string') input.nuevoFin = body.nuevo_fin;
        const out = ejecutarAccionPortalTurno(db, input, config);
        res.status(200).json(out);
      } catch (err) {
        next(err);
      }
    };
  }

  router.post('/portal/turnos/:id/confirmar', requirePortal, accion('confirmar'));
  router.post('/portal/turnos/:id/cancelar', requirePortal, accion('cancelar'));
  router.post('/portal/turnos/:id/reprogramar', requirePortal, accion('reprogramar'));

  return router;
}
