/**
 * Middleware centralizado de errores (design D5): único punto de traducción a
 * JSON. `AppError` conocido → su `status`; no controlado → `500 {"error":"interno"}`
 * sin stack, rutas internas, SQL ni PHI (spec platform/foundation; R3).
 */
import type { ErrorRequestHandler } from 'express';
import { AppError } from './errors.js';
import { createLogger, defaultSink, type Logger } from './logger.js';

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (res.headersSent) return;

    if (err instanceof AppError) {
      logger.warn('request error', { code: err.code, status: err.status });
      res.status(err.status).json(err.toBody());
      return;
    }

    logger.error('unhandled error', {
      name: err instanceof Error ? err.name : 'unknown',
    });
    res.status(500).json({ error: 'interno' });
  };
}

/** Instancia por defecto (sink estructurado a stdout/stderr). */
export const errorHandler: ErrorRequestHandler = createErrorHandler(
  createLogger(defaultSink),
);
