/** Factory de app Express (testeable con supertest, sin listen). */
import express, { type Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { authRouter } from '../auth/auth.routes.js';
import type { AuthConfig } from '../auth/types.js';
import { turnosRouter } from '../agenda/turnos.routes.js';
import { errorHandler } from './error-handler.js';
import { createLogger, defaultSink } from './logger.js';

const logger = createLogger(defaultSink);

export function createApp(db: DatabaseSync, authConfig: AuthConfig): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    logger.info('request', { method: req.method, path: req.path });
    next();
  });
  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  app.use('/api', authRouter(db, authConfig));
  app.use('/api', turnosRouter(db, authConfig));
  app.use(errorHandler);
  return app;
}
