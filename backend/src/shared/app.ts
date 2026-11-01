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
  app.use(errorHandler);
  return app;
}
