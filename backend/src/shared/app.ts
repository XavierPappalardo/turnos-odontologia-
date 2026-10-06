/** Factory de app Express (testeable con supertest, sin listen). */
import express, { type Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { turnosRouter } from '../agenda/turnos.routes.js';

export function createApp(db: DatabaseSync): Express {
  const app = express();
  app.use(express.json());
  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  app.use('/api', turnosRouter(db));
  return app;
}
