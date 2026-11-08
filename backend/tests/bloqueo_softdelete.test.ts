/**
 * Escenarios Vitest Dado/Cuando/Entonces — C-08 baja lógica de bloqueos.
 * SQLite real en memoria (R11/R12: sin mock de transacción).
 * Fixtures estrictamente ficticios (R1/R12). Sin PHI (R3).
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { BloqueoRepository } from '../src/agenda/bloqueo.repository.js';
import { crearTurno } from '../src/agenda/crearTurno.service.js';
import { TurnoRepository } from '../src/agenda/turno.repository.js';
import { createApp } from '../src/shared/app.js';
import { openDatabase } from '../src/shared/repository.js';
import type { ProfesionalId, SillonId } from '../src/shared/types.js';
import {
  APP_CONFIG,
  bearer,
  PAC,
  PROF,
  PROF2,
  resetSecuencia,
  seedBase,
  sembrarBloqueo,
  sembrarTurno,
  SILLA,
  SILLA2,
} from './helpers/agenda-fixtures.js';

// ── Fixtures ficticios compartidos (R1/R12, task 6.4) ──────────────────────
let db: DatabaseSync;

beforeEach(() => {
  resetSecuencia();
  db = openDatabase(':memory:');
  seedBase(db);
});

afterEach(() => {
  db.close();
});

// ── 1.1 RED: filtro `deleted_at IS NULL` en las consultas de agenda ─────────
describe('Dado un bloqueo vigente y otro dado de baja lógica', () => {
  it('Cuando consulto existeBloqueoAplicable Entonces solo aplica el vigente', () => {
    // Dado
    sembrarBloqueo(db, {
      inicio: '2026-10-07T09:00:00.000Z',
      fin: '2026-10-07T10:00:00.000Z',
    });
    sembrarBloqueo(db, {
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T12:00:00.000Z',
      deletedAt: '2026-10-06T00:00:00.000Z',
    });
    const repo = new BloqueoRepository(db);
    // Cuando
    const enHuecoBaja = repo.existeBloqueoAplicable(
      PROF as ProfesionalId,
      SILLA as SillonId,
      '2026-10-07T11:00:00.000Z',
      '2026-10-07T11:30:00.000Z',
    );
    const enHuecoVigente = repo.existeBloqueoAplicable(
      PROF as ProfesionalId,
      SILLA as SillonId,
      '2026-10-07T09:15:00.000Z',
      '2026-10-07T09:45:00.000Z',
    );
    // Entonces
    expect(enHuecoBaja).toBe(false);
    expect(enHuecoVigente).toBe(true);
  });
});

describe('Dado un turno activo y otro dado de baja lógica en el mismo hueco', () => {
  it('Cuando consulto existeSolapeProfesional Entonces ignora el soft-deleted', () => {
    // Dado
    sembrarTurno(db, {
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
      deletedAt: '2026-10-06T00:00:00.000Z',
    });
    sembrarTurno(db, {
      inicio: '2026-10-07T12:00:00.000Z',
      fin: '2026-10-07T12:30:00.000Z',
    });
    const repo = new TurnoRepository(db);
    // Cuando
    const enHuecoBaja = repo.existeSolapeProfesional(
      PROF as ProfesionalId,
      '2026-10-07T10:00:00.000Z',
      '2026-10-07T10:30:00.000Z',
    );
    const enHuecoVigente = repo.existeSolapeProfesional(
      PROF as ProfesionalId,
      '2026-10-07T12:00:00.000Z',
      '2026-10-07T12:30:00.000Z',
    );
    // Entonces
    expect(enHuecoBaja).toBe(false);
    expect(enHuecoVigente).toBe(true);
  });

  it('Cuando consulto existeSolapeSillon Entonces ignora el soft-deleted', () => {
    // Dado
    sembrarTurno(db, {
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
      deletedAt: '2026-10-06T00:00:00.000Z',
    });
    sembrarTurno(db, {
      prof: PROF2,
      inicio: '2026-10-07T12:00:00.000Z',
      fin: '2026-10-07T12:30:00.000Z',
    });
    const repo = new TurnoRepository(db);
    // Cuando
    const enHuecoBaja = repo.existeSolapeSillon(
      SILLA as SillonId,
      '2026-10-07T10:00:00.000Z',
      '2026-10-07T10:30:00.000Z',
    );
    const enHuecoVigente = repo.existeSolapeSillon(
      SILLA as SillonId,
      '2026-10-07T12:00:00.000Z',
      '2026-10-07T12:30:00.000Z',
    );
    // Entonces
    expect(enHuecoBaja).toBe(false);
    expect(enHuecoVigente).toBe(true);
  });

  it('Cuando consulto contarActivosEnHueco Entonces no cuenta el soft-deleted', () => {
    // Dado: dos activos + uno dado de baja en el mismo hueco
    sembrarTurno(db, {
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
      estado: 'confirmado',
    });
    sembrarTurno(db, {
      inicio: '2026-10-07T10:30:00.000Z',
      fin: '2026-10-07T11:00:00.000Z',
    });
    sembrarTurno(db, {
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T11:00:00.000Z',
      deletedAt: '2026-10-06T00:00:00.000Z',
    });
    const repo = new TurnoRepository(db);
    // Cuando
    const activos = repo.contarActivosEnHueco(
      PROF as ProfesionalId,
      SILLA as SillonId,
      '2026-10-07T09:00:00.000Z',
      '2026-10-07T12:00:00.000Z',
    );
    // Entonces
    expect(activos).toBe(2);
  });
});

// ── 1.3 TRIANGULATE: el filtro gobierna el servicio crearTurno ──────────────
interface ErrorCapturado {
  status: number | undefined;
  eje: string | undefined;
}

function capturarError(fn: () => void): ErrorCapturado {
  try {
    fn();
  } catch (err) {
    const capturado = err as { status?: number; eje?: string };
    return { status: capturado.status, eje: capturado.eje };
  }
  return { status: undefined, eje: undefined };
}

describe('Dado un bloqueo vigente Cuando crearTurno lo intersecta y luego se da de baja', () => {
  it('Entonces 409 eje=bloqueo y tras el soft-delete el mismo turno es 201', () => {
    // Dado: bloqueo vigente del profesional 10:00-12:00
    const bloqueoId = sembrarBloqueo(db, {
      prof: PROF,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T12:00:00.000Z',
    });
    const turnos = new TurnoRepository(db);
    const input = {
      profesionalId: PROF,
      sillonId: SILLA,
      pacienteId: PAC,
      inicio: '2026-10-07T11:00:00.000Z',
      fin: '2026-10-07T11:30:00.000Z',
      rol: 'recepcion' as const,
    };

    // Cuando: bloqueo vigente
    const rechazo = capturarError(() => {
      crearTurno(db, input, APP_CONFIG.recordatorio);
    });

    // Entonces: 409 eje=bloqueo y sin turno persistido
    expect(rechazo.status).toBe(409);
    expect(rechazo.eje).toBe('bloqueo');
    expect(turnos.countAll()).toBe(0);

    // Cuando: baja lógica por SQL directo (la ruta DELETE llega en la tarea 5.x)
    db.prepare(`UPDATE bloqueo SET deleted_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      bloqueoId,
    );
    const creado = crearTurno(db, input, APP_CONFIG.recordatorio);

    // Entonces: el bloqueo dado de baja ya no aplica
    expect(creado.estado).toBe('reservado');
    expect(turnos.countAll()).toBe(1);
  });
});


// -- 2.1 RED: primitivas update/softDelete del BaseRepository ----------------
interface BloqueoPersistido {
  motivo: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function leerBloqueo(id: string): BloqueoPersistido {
  return db
    .prepare(
      `SELECT motivo, created_at, updated_at, deleted_at FROM bloqueo WHERE id = ?`,
    )
    .get(id) as unknown as BloqueoPersistido;
}

function envejecerBloqueo(id: string, sello: string): void {
  db.prepare(`UPDATE bloqueo SET updated_at = ? WHERE id = ?`).run(sello, id);
}

describe('Dado un bloqueo persistido Cuando aplico softDelete del BaseRepository', () => {
  it('Entonces devuelve true una vez y false la segunda, conservando deleted_at', () => {
    // Dado
    const id = sembrarBloqueo(db, {
      prof: PROF,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T12:00:00.000Z',
    });
    const repo = new BloqueoRepository(db);

    // Cuando / Entonces: primera baja
    expect(repo.softDelete(id)).toBe(true);
    const primera = leerBloqueo(id);
    expect(typeof primera.deleted_at).toBe('string');

    // Cuando: segunda baja
    expect(repo.softDelete(id)).toBe(false);

    // Entonces: el sello original no se reescribe
    expect(leerBloqueo(id).deleted_at).toBe(primera.deleted_at);
  });
});

describe('Dado un bloqueo persistido Cuando aplico update del BaseRepository', () => {
  it('Entonces cambia el motivo, refresca updated_at y un id inexistente devuelve false', () => {
    // Dado
    const id = sembrarBloqueo(db, {
      prof: PROF,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T12:00:00.000Z',
    });
    const selloViejo = '2020-01-01T00:00:00.000Z';
    envejecerBloqueo(id, selloViejo);
    const repo = new BloqueoRepository(db);

    // Cuando
    const actualizado = repo.update(id, { motivo: 'motivo actualizado ficticio' });

    // Entonces
    expect(actualizado).toBe(true);
    const row = leerBloqueo(id);
    expect(row.motivo).toBe('motivo actualizado ficticio');
    expect(row.updated_at).not.toBe(selloViejo);

    // Cuando: id inexistente
    const inexistente = repo.update('bloq-inexistente', { motivo: 'x' });

    // Entonces
    expect(inexistente).toBe(false);
  });
});

// -- 2.3 TRIANGULATE: patch vac�o y validador de identificadores -------------
describe('Dado un bloqueo persistido Cuando env�o un patch vac�o', () => {
  it('Entonces devuelve true y solo refresca updated_at', () => {
    // Dado
    const id = sembrarBloqueo(db, {
      inicio: '2026-10-08T10:00:00.000Z',
      fin: '2026-10-08T12:00:00.000Z',
    });
    const selloViejo = '2020-01-01T00:00:00.000Z';
    envejecerBloqueo(id, selloViejo);
    const antes = leerBloqueo(id);
    const repo = new BloqueoRepository(db);

    // Cuando
    const resultado = repo.update(id, {});

    // Entonces
    expect(resultado).toBe(true);
    const despues = leerBloqueo(id);
    expect(despues.updated_at).not.toBe(selloViejo);
    expect(despues.motivo).toBe(antes.motivo);
    expect(despues.deleted_at).toBe(antes.deleted_at);
  });
});

describe('Dado un patch con nombre de columna inv�lido', () => {
  it('Entonces lanza Error antes de emitir SQL y no modifica la tabla', () => {
    // Dado
    const id = sembrarBloqueo(db, {
      inicio: '2026-10-08T10:00:00.000Z',
      fin: '2026-10-08T12:00:00.000Z',
    });
    const antes = leerBloqueo(id);
    const repo = new BloqueoRepository(db);
    const patchInvalido = {
      Motivo: 'x',
    } as unknown as Parameters<typeof repo.update>[1];

    // Cuando / Entonces
    expect(() => repo.update(id, patchInvalido)).toThrow(Error);

    // Entonces: la fila y la tabla siguen intactas
    expect(leerBloqueo(id)).toEqual(antes);
    expect(repo.countAll()).toBe(1);
  });
});

// -- 6.1 RED: flujo HTTP completo de baja lógica -----------------------------
describe('Dado un bloqueo creado por HTTP Cuando intento turno, lo doy de baja y reintento', () => {
  it('Entonces 409 eje=bloqueo, DELETE 204, turno 201, GET sin el bloqueo y segunda baja 404', async () => {
    // Dado
    const app = createApp(db, APP_CONFIG);
    const auth = bearer(['recepcion']);
    const alta = await request(app)
      .post('/api/bloqueos')
      .set('authorization', auth)
      .send({
        profesional_id: PROF,
        sillon_id: null,
        inicio: '2026-10-07T10:00:00.000Z',
        fin: '2026-10-07T12:00:00.000Z',
        motivo: 'bloqueo ficticio e2e',
      });
    expect(alta.status).toBe(201);
    const bloqueoId = alta.body.id as string;
    const turnoInput = {
      profesional_id: PROF,
      sillon_id: SILLA,
      paciente_id: PAC,
      inicio: '2026-10-07T11:00:00.000Z',
      fin: '2026-10-07T11:30:00.000Z',
    };

    // Cuando: el bloqueo vigente intersecta el turno
    const rechazo = await request(app)
      .post('/api/turnos')
      .set('authorization', auth)
      .send(turnoInput);

    // Entonces
    expect(rechazo.status).toBe(409);
    expect(rechazo.body.eje).toBe('bloqueo');
    expect(new TurnoRepository(db).countAll()).toBe(0);

    // Cuando: doy de baja el bloqueo
    const baja = await request(app)
      .delete(`/api/bloqueos/${bloqueoId}`)
      .set('authorization', auth);

    // Entonces: 204 y la fila conserva deleted_at
    expect(baja.status).toBe(204);
    const repo = new BloqueoRepository(db);
    const selloBaja = repo.findById(bloqueoId)?.deleted_at;
    expect(typeof selloBaja).toBe('string');

    // Entonces: el listado ya no lo incluye
    const listado = await request(app)
      .get('/api/bloqueos')
      .set('authorization', auth);
    expect(listado.status).toBe(200);
    expect(
      listado.body.bloqueos.map((b: { id: string }) => b.id),
    ).not.toContain(bloqueoId);

    // Cuando: repito el mismo turno
    const creado = await request(app)
      .post('/api/turnos')
      .set('authorization', auth)
      .send(turnoInput);

    // Entonces: el hueco qued� libre
    expect(creado.status).toBe(201);
    expect(creado.body.estado).toBe('reservado');

    // Cuando: repito la baja
    const segunda = await request(app)
      .delete(`/api/bloqueos/${bloqueoId}`)
      .set('authorization', auth);

    // Entonces: 404 y deleted_at no se reescribe
    expect(segunda.status).toBe(404);
    expect(repo.findById(bloqueoId)?.deleted_at).toBe(selloBaja);
  });
});

// -- 6.3 TRIANGULATE: bloqueo global que libera a todos ----------------------
describe('Dado un bloqueo global creado por HTTP Cuando lo doy de baja', () => {
  it('Entonces bloquea a todo profesional y sill�n y luego libera a ambos', async () => {
    // Dado
    const app = createApp(db, APP_CONFIG);
    const auth = bearer(['administracion']);
    const alta = await request(app)
      .post('/api/bloqueos')
      .set('authorization', auth)
      .send({
        profesional_id: null,
        sillon_id: null,
        inicio: '2026-10-08T10:00:00.000Z',
        fin: '2026-10-08T12:00:00.000Z',
      });
    expect(alta.status).toBe(201);
    const bloqueoId = alta.body.id as string;
    const turnoUno = {
      profesional_id: PROF,
      sillon_id: SILLA,
      paciente_id: PAC,
      inicio: '2026-10-08T10:15:00.000Z',
      fin: '2026-10-08T10:45:00.000Z',
    };
    const turnoDos = {
      profesional_id: PROF2,
      sillon_id: SILLA2,
      paciente_id: PAC,
      inicio: '2026-10-08T11:00:00.000Z',
      fin: '2026-10-08T11:30:00.000Z',
    };

    // Cuando: cualquier combinaci�n de profesional/sill�n
    const primero = await request(app)
      .post('/api/turnos')
      .set('authorization', auth)
      .send(turnoUno);
    const segundo = await request(app)
      .post('/api/turnos')
      .set('authorization', auth)
      .send(turnoDos);

    // Entonces: ambos rechazados por el bloqueo global
    expect([primero.status, segundo.status]).toEqual([409, 409]);
    expect([primero.body.eje, segundo.body.eje]).toEqual([
      'bloqueo',
      'bloqueo',
    ]);
    expect(new TurnoRepository(db).countAll()).toBe(0);

    // Cuando: doy de baja el bloqueo global
    const baja = await request(app)
      .delete(`/api/bloqueos/${bloqueoId}`)
      .set('authorization', auth);
    expect(baja.status).toBe(204);

    // Entonces: ambos profesionales y sillones quedan libres
    const libreUno = await request(app)
      .post('/api/turnos')
      .set('authorization', auth)
      .send(turnoUno);
    const libreDos = await request(app)
      .post('/api/turnos')
      .set('authorization', auth)
      .send(turnoDos);
    expect([libreUno.status, libreDos.status]).toEqual([201, 201]);
    expect(new TurnoRepository(db).countAll()).toBe(2);
  });
});
