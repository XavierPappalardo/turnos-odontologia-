/** Factory de app Express (testeable con supertest, sin listen). */
import express, { type Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { authRouter } from '../auth/auth.routes.js';
import type { AppConfig } from './config.js';
import { turnosRouter } from '../agenda/turnos.routes.js';
import { bloqueosRouter } from '../agenda/bloqueos.routes.js';
import { reservaOnlineRouter } from '../agenda/reservaOnline.routes.js';
import { turnoTokenRouter } from '../agenda/turnoToken.routes.js';
import { recordatorioRouter } from '../notificaciones/recordatorio.routes.js';
import { historiaClinicaRouter } from '../clinica/historiaClinica.routes.js';
import { odontogramaRouter } from '../clinica/odontograma.routes.js';
import { pacientesRouter } from '../clinica/pacientes.routes.js';
import { presupuestosRouter } from '../clinica/presupuestos.routes.js';
import { planesRouter } from '../obras-sociales/planes.routes.js';
import { coberturasRouter } from '../obras-sociales/coberturas.routes.js';
import { liquidacionesRouter } from '../obras-sociales/liquidaciones.routes.js';
import { configuracionesRouter } from '../comisiones/configuraciones.routes.js';
import { liquidacionesRouter as comisionesRouter } from '../comisiones/liquidaciones.routes.js';
import { cajaRouter } from '../caja/caja.routes.js';
import {
  catalogoPublicoRouter,
  catalogoRouter,
} from '../catalogo/catalogo.routes.js';
import { errorHandler } from './error-handler.js';
import { createLogger, defaultSink } from './logger.js';

const logger = createLogger(defaultSink);

export function createApp(db: DatabaseSync, config: AppConfig): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    logger.info('request', { method: req.method, path: req.path });
    next();
  });
  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  app.use('/api', authRouter(db, config));
  app.use('/api', turnosRouter(db, config));
  app.use('/api', bloqueosRouter(db, config));
  app.use('/api/public', reservaOnlineRouter(db, config));
  app.use('/api/public', turnoTokenRouter(db, config));
  app.use('/api/public', recordatorioRouter(db, config));
  app.use('/api/public', catalogoPublicoRouter(db));
  app.use('/api', historiaClinicaRouter(db));
  app.use('/api', odontogramaRouter(db));
  app.use('/api', pacientesRouter(db));
  app.use('/api', presupuestosRouter(db));
  app.use('/api/obras-sociales', planesRouter(db, config));
  app.use('/api/obras-sociales', coberturasRouter(db, config));
  app.use('/api/obras-sociales', liquidacionesRouter(db, config));
  app.use('/api/comisiones', configuracionesRouter(db, config));
  app.use('/api/comisiones', comisionesRouter(db, config));
  app.use('/api', cajaRouter(db, config));
  app.use('/api', catalogoRouter(db, config));
  app.use(errorHandler);
  return app;
}
