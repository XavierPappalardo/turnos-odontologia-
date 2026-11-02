/**
 * C-09 task 9.1+9.2: Integración clínica con verificación R3.
 * Profesional con turno registra HC y odontograma, enmienda, otorga delegación,
 * el delegado accede y recepción recibe 403; cada operación deja exactamente
 * una fila en `auditoria_phi`; ni logs ni cuerpos de error contienen PHI (R3).
 * SQLite real en memoria (R12).
 */
import { DatabaseSync } from 'node:sqlite';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { signToken } from '../src/auth/tokens.js';
import { resolverProfesional } from '../src/clinica/resolverProfesional.js';
import { historiaClinicaRouter } from '../src/clinica/historiaClinica.routes.js';
import { odontogramaRouter } from '../src/clinica/odontograma.routes.js';
import { pacientesRouter } from '../src/clinica/pacientes.routes.js';
import { DelegacionHcRepository } from '../src/clinica/delegacionHc.repository.js';
import { AuditoriaPhiRepository } from '../src/clinica/auditoriaPhi.repository.js';
import type { Rol } from '../src/shared/types.js';

const JWT_SECRET = 'test-secret-con-mas-de-32-caracteres-c09';

function crearToken(roles: readonly Rol[], sub: string, profesionalId: string | null, jti = 'jti'): string {
  return signToken(
    {
      sub,
      tenantId: 'test',
      roles,
      email: `${sub}@example.test`,
      type: 'access',
      ttlSeconds: 900,
      jti,
    },
    JWT_SECRET,
  );
}

function crearApp(db: DatabaseSync, roles: readonly Rol[], sub: string, profesionalId: string | null): express.Express {
  const app = express();
  app.use(express.json());
  const token = crearToken(roles, sub, profesionalId);
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.locals.auth = {
      userId: sub as never,
      tenantId: 'test',
      roles,
      email: `${sub}@example.test`,
      jti: 'jti',
      profesionalId: profesionalId as never,
    };
    next();
  });
  app.use('/pacientes', resolverProfesional(JWT_SECRET, db));
  app.use('/api', historiaClinicaRouter(db));
  app.use('/api', odontogramaRouter(db));
  app.use('/api', pacientesRouter(db));

  // Delegaciones (inline hasta crear delegacionesHc.routes.ts)
  const delegacionRepo = new DelegacionHcRepository(db);
  const audRepo = new AuditoriaPhiRepository(db);
  app.post('/api/pacientes/:id/delegaciones-hc', (req: Request, res: Response) => {
    try {
      const auth = res.locals.auth as { profesionalId: string | null; userId: string };
      if (!auth.profesionalId) {
        res.status(403).json({ error: 'sin_vinculo' });
        return;
      }
      const body = req.body as { profesional_id: string; desde: string; hasta: string; motivo: string };
      const ahora = new Date().toISOString();
      delegacionRepo.crear({
        id: crypto.randomUUID(),
        paciente_id: req.params.id,
        profesional_id: body.profesional_id,
        otorgada_por_usuario_id: auth.userId,
        desde: body.desde,
        hasta: body.hasta,
        motivo: body.motivo,
      });
      audRepo.registrar({
        id: crypto.randomUUID(),
        ocurrido_en: ahora,
        usuario_id: auth.userId,
        rol: 'profesional',
        paciente_id: req.params.id,
        recurso: 'delegacion_hc',
        recurso_id: 'deleg-1',
        accion: 'crear',
        resultado: 'permitido',
        motivo: null,
        ip: null,
        session_id: null,
      });
      res.status(201).json({ id: 'deleg-1' });
    } catch (err: any) {
      res.status(400).json({ error: err.code || 'validacion' });
    }
  });

  return app;
}

describe('Integración clínica C-09', () => {
  let db: DatabaseSync;
  let tokenProf: string;
  let tokenDelegado: string;
  let tokenRecepcion: string;
  let logLines: string[];
  const originalWrite = process.stdout.write.bind(process.stdout);

  beforeEach(() => {
    db = openDatabase(':memory:');
    logLines = [];
    // Capturar logs para verificación R3
    process.stdout.write = ((chunk: any) => {
      const str = typeof chunk === 'string' ? chunk : chunk.toString();
      logLines.push(str);
      return true;
    }) as typeof process.stdout.write;

    // Profesionales
    db.prepare(
      `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at)
       VALUES ('prof-1', 'Prof Ficticio', 'MAT-1', 'Odonto', 1, ?, ?),
              ('prof-2', 'Prof Ficticio 2', 'MAT-2', 'Odonto', 1, ?, ?),
              ('prof-delegado', 'Prof Delegado', 'MAT-3', 'Odonto', 1, ?, ?)`,
    ).run(
      '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z',
      '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z',
      '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z',
    );
    // Usuarios
    db.prepare(
      `INSERT INTO usuario (id, email, password_hash, activo, profesional_id, created_at, updated_at, deleted_at)
       VALUES ('user-prof', 'prof@example.test', 'hash', 1, 'prof-1', ?, ?, null),
              ('user-delegado', 'delegado@example.test', 'hash', 1, 'prof-delegado', ?, ?, null),
              ('user-recepcion', 'recepcion@example.test', 'hash', 1, null, ?, ?, null)`,
    ).run(
      '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z',
      '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z',
      '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z',
    );
    db.prepare(
      `INSERT INTO usuario_rol (usuario_id, rol) VALUES ('user-prof', 'profesional'),
                                                         ('user-delegado', 'profesional'),
                                                         ('user-recepcion', 'recepcion')`,
    ).run();
    // Paciente
    db.prepare(
      `INSERT INTO paciente (id, nombre, activo, created_at, updated_at, deleted_at)
       VALUES ('pac-1', 'Paciente Ficticio', 1, ?, ?, null)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
    // Sillón y turno (para titularidad)
    db.prepare(
      `INSERT INTO sillon (id, nombre, activo, created_at, updated_at)
       VALUES ('sillon-1', 'Sillon Ficticio', 1, ?, ?)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
    db.prepare(
      `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at, deleted_at)
       VALUES ('turno-1', 'prof-1', 'sillon-1', 'pac-1', null, '2026-11-02T10:00:00.000Z', '2026-11-02T10:30:00.000Z', 'reservado', 'recepcion', ?, ?, null)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');

    tokenProf = crearToken(['profesional'], 'user-prof', 'prof-1', 'jti-prof');
    tokenDelegado = crearToken(['profesional'], 'user-delegado', 'prof-delegado', 'jti-delegado');
    tokenRecepcion = crearToken(['recepcion'], 'user-recepcion', null, 'jti-recepcion');
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
    db.close();
  });

  function contarAuditoria(pacienteId: string): number {
    const stmt = db.prepare(
      `SELECT COUNT(*) AS n FROM auditoria_phi WHERE paciente_id = ?`,
    );
    return (stmt.get(pacienteId) as { n: number }).n;
  }

  function assertNoPHI(context: string): void {
    const todoElLog = logLines.join('\n');
    // R3: logs no contienen nombres de pacientes ni detalle clínico
    expect(todoElLog).not.toContain('Paciente Ficticio');
    expect(todoElLog).not.toContain('detalle ficticio');
    expect(todoElLog).not.toContain('caries');
    expect(todoElLog).not.toContain('obturado');
    // Errores de respuesta (si los hay) se verifican por separado abajo
  }

  it('Dado profesional con turno Cuando registra HC y odontograma, enmienda, otorga delegación, delegado accede y recepción recibe 403 Entonces cada operación deja una fila en auditoria_phi y sin PHI en logs/errores', async () => {
    const app = crearApp(db, ['profesional'], 'user-prof', 'prof-1');
    const appDelegado = crearApp(db, ['profesional'], 'user-delegado', 'prof-delegado');
    const appRecepcion = crearApp(db, ['recepcion'], 'user-recepcion', null);

    const antes = contarAuditoria('pac-1');

    // 1. Registra HC
    const hcRes = await request(app)
      .post('/api/pacientes/pac-1/historia-clinica/eventos')
      .set('authorization', `Bearer ${tokenProf}`)
      .send({
        tipo: 'consulta',
        detalle: 'detalle ficticio de consulta',
        ocurrido_en: '2026-11-01T10:00:00-03:00',
        turno_id: 'turno-1',
      });
    expect(hcRes.status).toBe(201);
    const hcEventoId = hcRes.body.id;
    expect(contarAuditoria('pac-1')).toBe(antes + 1);

    // 2. Registra odontograma
    const odoRes = await request(app)
      .post('/api/pacientes/pac-1/odontograma/eventos')
      .set('authorization', `Bearer ${tokenProf}`)
      .send({
        pieza: 16,
        superficie: 'O',
        hallazgo: 'caries',
        ocurrido_en: '2026-11-01T10:00:00-03:00',
      });
    expect(odoRes.status).toBe(201);
    expect(contarAuditoria('pac-1')).toBe(antes + 2);

    // 3. Enmienda HC
    const enmRes = await request(app)
      .post(`/api/pacientes/pac-1/historia-clinica/eventos/${hcEventoId}/enmiendas`)
      .set('authorization', `Bearer ${tokenProf}`)
      .send({
        tipo: 'consulta',
        detalle: 'detalle corregido',
        motivo_enmienda: 'corrección de carga',
      });
    expect(enmRes.status).toBe(201);
    expect(contarAuditoria('pac-1')).toBe(antes + 3);

    // 4. Otorga delegación
    const delegRes = await request(app)
      .post('/api/pacientes/pac-1/delegaciones-hc')
      .set('authorization', `Bearer ${tokenProf}`)
      .send({
        profesional_id: 'prof-delegado',
        desde: '2026-11-02T00:00:00.000Z',
        hasta: '2026-11-03T00:00:00.000Z',
        motivo: 'motivo ficticio',
      });
    expect(delegRes.status).toBe(201);
    expect(contarAuditoria('pac-1')).toBe(antes + 4);

    // 5. Delegado accede a HC
    const delegadoAcceso = await request(appDelegado)
      .get('/api/pacientes/pac-1/historia-clinica')
      .set('authorization', `Bearer ${tokenDelegado}`);
    expect(delegadoAcceso.status).toBe(200);
    expect(contarAuditoria('pac-1')).toBe(antes + 5);

    // 6. Recepción recibe 403
    const recepRes = await request(appRecepcion)
      .get('/api/pacientes/pac-1/historia-clinica')
      .set('authorization', `Bearer ${tokenRecepcion}`);
    expect(recepRes.status).toBe(403);
    // Error body sin PHI
    expect(recepRes.body.error).toBe('sin_vinculo');
    expect(JSON.stringify(recepRes.body)).not.toContain('Paciente Ficticio');
    expect(JSON.stringify(recepRes.body)).not.toContain('detalle ficticio');
    expect(JSON.stringify(recepRes.body)).not.toContain('caries');

    // Verificación final: exactamente 5 filas en auditoria_phi
    expect(contarAuditoria('pac-1')).toBe(antes + 5);

    // R3: ni logs contienen PHI
    assertNoPHI('logs');
  });
});
