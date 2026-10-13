/**
 * Errores tipados + middleware centralizado (spec platform/foundation: manejo
 * centralizado de errores; design D5). Verifica 4xx conocido y 500 genérico sin
 * stack, rutas internas, SQL ni PHI (R3).
 */
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createErrorHandler } from '../src/shared/error-handler.js';
import { AppError, CrearTurnoError } from '../src/shared/errors.js';
import { createLogger, type LogLevel } from '../src/shared/logger.js';

function buildApp(handler: RequestHandler): { app: express.Express; lines: string[] } {
  const lines: string[] = [];
  const sink = (line: string, _level: LogLevel): void => {
    lines.push(line);
  };
  const app = express();
  app.get('/boom', handler);
  app.use(createErrorHandler(createLogger(sink)));
  return { app, lines };
}

describe('excepciones tipadas AppError', () => {
  it('Dado AppError Cuando inspecciono Entonces expone status/code y toBody{error}', () => {
    const err = new AppError({ status: 400, code: 'validacion', message: 'x' });
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(400);
    expect(err.code).toBe('validacion');
    expect(err.toBody()).toEqual({ error: 'validacion' });
  });

  it('Dado CrearTurnoError Cuando inspecciono Entonces extiende AppError sin cambiar su forma', () => {
    const err = new CrearTurnoError({
      status: 409,
      code: 'conflicto',
      message: 'solape',
      eje: 'profesional',
    });
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(409);
    expect(err.toBody()).toEqual({ error: 'conflicto', eje: 'profesional' });
  });
});

describe('middleware centralizado de errores', () => {
  it('Dado AppError conocido Cuando falla Entonces responde su 4xx JSON', async () => {
    const { app } = buildApp((_req, _res, next) =>
      next(new AppError({ status: 404, code: 'not_found', message: 'no existe' })),
    );
    const res = await request(app).get('/boom');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  it('Dado CrearTurnoError Cuando falla Entonces mapea a su status con cuerpo sin PHI', async () => {
    const { app } = buildApp((_req, _res, next) =>
      next(
        new CrearTurnoError({
          status: 409,
          code: 'conflicto',
          message: 'solape por profesional',
          eje: 'profesional',
        }),
      ),
    );
    const res = await request(app).get('/boom');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'conflicto', eje: 'profesional' });
  });

  it('Dado error inesperado Cuando falla Entonces 500 {"error":"interno"} sin stack/SQL/rutas/PHI', async () => {
    const { app, lines } = buildApp((_req, _res, next) =>
      next(
        new Error(
          'SQLITE_ERROR: SELECT * FROM paciente; nombre=Paciente Ficticio Ejemplo',
        ),
      ),
    );
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'interno' });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/SQLITE|SELECT|paciente|Ficticio|at |\.ts/);
    expect(lines.join('\n')).not.toMatch(/Ficticio|SELECT|SQLITE/);
  });

  it('Dado error no controlado Cuando falla Entonces no filtra rutas internas ni stack', async () => {
    const { app } = buildApp((_req, _res, next) =>
      next(new Error('/src/shared/secret-internal.ts line 42')),
    );
    const res = await request(app).get('/boom');
    const raw = `${JSON.stringify(res.body)}${res.text}`;
    expect(raw).not.toMatch(/secret-internal\.ts|line 42|\/src\/|at Object/);
  });
});
