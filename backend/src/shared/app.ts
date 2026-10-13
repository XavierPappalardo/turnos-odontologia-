/** Factory de app Express (testeable con supertest, sin listen). */
import express, { type Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { turnosRouter } from '../agenda/turnos.routes.js';
import { errorHandler } from './error-handler.js';
import { createLogger, defaultSink } from './logger.js';

const logger = createLogger(defaultSink);

export function createApp(db: DatabaseSync): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    logger.info('request', { method: req.method, path: req.path });
    next();
  });
  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  app.use('/api', turnosRouter(db));
  app.use(errorHandler);
  return app;
}
