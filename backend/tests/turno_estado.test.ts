/**
 * C-04 máquina de estados de Turno (KB-04 §9).
 * `reservado → confirmado → presente → atendido`,
 * `reservado|confirmado → cancelado`, `confirmado → ausente`.
 * SQLite real en memoria (R12); datos ficticios (R1).
 */
import { DatabaseSync } from 'node:sqlite';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cambiarEstadoTurno, puedeTransicionar } from '../src/agenda/turnoEstado.service.js';
import { crearTurno } from '../src/agenda/crearTurno.service.js';
import { TurnoRepository } from '../src/agenda/turno.repository.js';
import { signToken } from '../src/auth/tokens.js';
import type { AuthConfig } from '../src/auth/types.js';
import { createApp } from '../src/shared/app.js';
import { openDatabase } from '../src/shared/repository.js';
import { SEED_IDS, seedMinimo } from '../src/shared/seed.js';
import type { Rol, TurnoEstado, TurnoId } from '../src/shared/types.js';

const AUTH: AuthConfig = {
  jwtSecret: 'test-secret-con-mas-de-32-caracteres-estado',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 3_600,
  loginRateLimitMax: 50,
  loginRateLimitWindowSeconds: 60,
  cookieSecure: false,
};

let db: DatabaseSync;

beforeEach(() => {
  db = openDatabase(':memory:');
  seedMinimo(db);
});

afterEach(() => {
  db.close();
});

function bearer(roles: readonly Rol[]): string {
  const token = signToken(
    {
      sub: 'user-test-estado',
      tenantId: 'test',
      roles,
      email: 'agenda@example.test',
      type: 'access',
      ttlSeconds: 900,
    },
    AUTH.jwtSecret,
  );
  return `Bearer ${token}`;
}

let contador = 0;

function crearTurnoBase(
  estadoInicial: TurnoEstado = 'reservado',
): string {
  const id = `turno-estado-${String(++contador).padStart(4, '0')}`;
  const repo = new TurnoRepository(db);
  repo.crear({
    id: id as TurnoId,
    profesionalId: SEED_IDS.profesional as never,
    sillonId: SEED_IDS.sillon as never,
    pacienteId: SEED_IDS.paciente as never,
    inicio: '2026-11-02T10:00:00.000Z',
    fin: '2026-11-02T10:30:00.000Z',
    estado: estadoInicial,
    origen: 'recepcion',
  });
  return id;
}

function estadoDe(id: string): TurnoEstado {
  const row = db
    .prepare('SELECT estado FROM turno WHERE id = ?')
    .get(id) as { estado: TurnoEstado };
  return row.estado;
}

describe('Dado un turno reservado Cuando recorro la cadena válida Entonces persiste cada estado', () => {
  it('reservado → confirmado → presente → atendido', () => {
    const id = crearTurnoBase();

    const confirmado = cambiarEstadoTurno(db, {
      turnoId: id,
      nuevoEstado: 'confirmado',
      rol: 'recepcion',
    });
    expect(confirmado.estado).toBe('confirmado');

    const presente = cambiarEstadoTurno(db, {
      turnoId: id,
      nuevoEstado: 'presente',
      rol: 'recepcion',
    });
    expect(presente.estado).toBe('presente');

    const atendido = cambiarEstadoTurno(db, {
      turnoId: id,
      nuevoEstado: 'atendido',
      rol: 'administracion',
    });
    expect(atendido.estado).toBe('atendido');
    expect(estadoDe(id)).toBe('atendido');
  });

  it('reservado → cancelado y confirmado → ausente son válidas', () => {
    const cancelable = crearTurnoBase();
    expect(
      cambiarEstadoTurno(db, {
        turnoId: cancelable,
        nuevoEstado: 'cancelado',
        rol: 'recepcion',
      }).estado,
    ).toBe('cancelado');

    const ausente = crearTurnoBase('confirmado');
    expect(
      cambiarEstadoTurno(db, {
        turnoId: ausente,
        nuevoEstado: 'ausente',
        rol: 'recepcion',
      }).estado,
    ).toBe('ausente');
  });
});

describe('Dado un turno Cuando intento una transición inválida Entonces 409 y no cambia', () => {
  const invalidas: readonly (readonly [TurnoEstado, TurnoEstado])[] = [
    ['reservado', 'presente'],
    ['reservado', 'ausente'],
    ['reservado', 'atendido'],
    ['confirmado', 'atendido'],
    ['presente', 'cancelado'],
    ['atendido', 'confirmado'],
    ['cancelado', 'reservado'],
    ['ausente', 'confirmado'],
  ];

  for (const [desde, hacia] of invalidas) {
    it(`${desde} → ${hacia}`, () => {
      const id = crearTurnoBase(desde);
      expect(() =>
        cambiarEstadoTurno(db, {
          turnoId: id,
          nuevoEstado: hacia,
          rol: 'recepcion',
        }),
      ).toThrowError(
        expect.objectContaining({ status: 409, code: 'transicion_invalida' }),
      );
      expect(estadoDe(id)).toBe(desde);
    });
  }

  it('estado inexistente en el body → 400', () => {
    const id = crearTurnoBase();
    expect(() =>
      cambiarEstadoTurno(db, {
        turnoId: id,
        nuevoEstado: 'volando',
        rol: 'recepcion',
      }),
    ).toThrowError(expect.objectContaining({ status: 400, code: 'validacion' }));
  });

  it('turno inexistente → 404', () => {
    expect(() =>
      cambiarEstadoTurno(db, {
        turnoId: 'turno-inexistente',
        nuevoEstado: 'confirmado',
        rol: 'recepcion',
      }),
    ).toThrowError(expect.objectContaining({ status: 404, code: 'not_found' }));
  });

  it('rol profesional no puede cambiar estados → 403', () => {
    const id = crearTurnoBase();
    expect(() =>
      cambiarEstadoTurno(db, {
        turnoId: id,
        nuevoEstado: 'confirmado',
        rol: 'profesional',
      }),
    ).toThrowError(expect.objectContaining({ status: 403, code: 'forbidden' }));
    expect(estadoDe(id)).toBe('reservado');
  });
});

describe('Dado el grafo de transiciones Cuando lo inspecciono Entonces coincide con KB-04 §9', () => {
  it('solo los estados activos tienen salidas y los terminales ninguna', () => {
    expect(puedeTransicionar('reservado', 'confirmado')).toBe(true);
    expect(puedeTransicionar('reservado', 'cancelado')).toBe(true);
    expect(puedeTransicionar('confirmado', 'presente')).toBe(true);
    expect(puedeTransicionar('confirmado', 'cancelado')).toBe(true);
    expect(puedeTransicionar('confirmado', 'ausente')).toBe(true);
    expect(puedeTransicionar('presente', 'atendido')).toBe(true);
    for (const terminal of ['atendido', 'cancelado', 'ausente'] as const) {
      for (const destino of ['reservado', 'confirmado', 'presente', 'atendido', 'cancelado', 'ausente'] as const) {
        expect(puedeTransicionar(terminal, destino)).toBe(false);
      }
    }
  });
});

describe('Dado un turno cancelado Cuando reservo el mismo hueco Entonces se libera', () => {
  it('cancelar permite crear otro turno en el mismo profesional/sillón/horario', () => {
    const primero = crearTurno(db, {
      profesionalId: SEED_IDS.profesional,
      sillonId: SEED_IDS.sillon,
      pacienteId: SEED_IDS.paciente,
      inicio: '2026-11-03T09:00:00.000Z',
      fin: '2026-11-03T09:30:00.000Z',
      rol: 'recepcion',
    });

    expect(() =>
      crearTurno(db, {
        profesionalId: SEED_IDS.profesional,
        sillonId: SEED_IDS.sillon,
        pacienteId: SEED_IDS.paciente,
        inicio: '2026-11-03T09:00:00.000Z',
        fin: '2026-11-03T09:30:00.000Z',
        rol: 'recepcion',
      }),
    ).toThrowError(expect.objectContaining({ status: 409 }));

    cambiarEstadoTurno(db, {
      turnoId: primero.id,
      nuevoEstado: 'cancelado',
      rol: 'recepcion',
    });

    const segundo = crearTurno(db, {
      profesionalId: SEED_IDS.profesional,
      sillonId: SEED_IDS.sillon,
      pacienteId: SEED_IDS.paciente,
      inicio: '2026-11-03T09:00:00.000Z',
      fin: '2026-11-03T09:30:00.000Z',
      rol: 'recepcion',
    });
    expect(segundo.estado).toBe('reservado');
    expect(segundo.id).not.toBe(primero.id);
  });
});

describe('PATCH /api/turnos/:id/estado', () => {
  it('Dado recepción autenticada Cuando confirma un turno Entonces 200 y estado persistido', async () => {
    const app = createApp(db, AUTH);
    const id = crearTurnoBase();
    const res = await request(app)
      .patch(`/api/turnos/${id}/estado`)
      .set('authorization', bearer(['recepcion']))
      .send({ estado: 'confirmado' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id, estado: 'confirmado' });
    expect(estadoDe(id)).toBe('confirmado');
  });

  it('Dado rol profesional Cuando PATCH Entonces 403', async () => {
    const app = createApp(db, AUTH);
    const id = crearTurnoBase();
    const res = await request(app)
      .patch(`/api/turnos/${id}/estado`)
      .set('authorization', bearer(['profesional']))
      .send({ estado: 'confirmado' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden' });
    expect(estadoDe(id)).toBe('reservado');
  });

  it('Dado sin token Cuando PATCH Entonces 401', async () => {
    const app = createApp(db, AUTH);
    const id = crearTurnoBase();
    const res = await request(app)
      .patch(`/api/turnos/${id}/estado`)
      .send({ estado: 'confirmado' });
    expect(res.status).toBe(401);
  });

  it('Dado transición inválida Cuando PATCH Entonces 409 con desde/hacia sin PHI', async () => {
    const app = createApp(db, AUTH);
    const id = crearTurnoBase('atendido');
    const res = await request(app)
      .patch(`/api/turnos/${id}/estado`)
      .set('authorization', bearer(['recepcion']))
      .send({ estado: 'confirmado' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'transicion_invalida',
      desde: 'atendido',
      hacia: 'confirmado',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/Ficticio|Paciente|dni/i);
  });

  it('Dado body sin estado o turno inexistente Entonces 400 / 404', async () => {
    const app = createApp(db, AUTH);
    const id = crearTurnoBase();
    const sinEstado = await request(app)
      .patch(`/api/turnos/${id}/estado`)
      .set('authorization', bearer(['recepcion']))
      .send({});
    expect(sinEstado.status).toBe(400);

    const inexistente = await request(app)
      .patch('/api/turnos/no-existe/estado')
      .set('authorization', bearer(['recepcion']))
      .send({ estado: 'confirmado' });
    expect(inexistente.status).toBe(404);
    expect(inexistente.body).toEqual({ error: 'not_found' });
  });

  it('Dado POST /api/turnos sin body Cuando recepción crea Entonces 400 (no 500)', async () => {
    const app = createApp(db, AUTH);
    const res = await request(app)
      .post('/api/turnos')
      .set('authorization', bearer(['recepcion']));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'validacion',
      detalle: 'campo obligatorio faltante',
    });
  });
});
