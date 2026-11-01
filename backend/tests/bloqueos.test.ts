/**
 * Escenarios Vitest Dado/Cuando/Entonces — C-08 CRUD de bloqueos de agenda.
 * SQLite real en memoria (R11/R12: sin mock de transacción).
 * Fixtures estrictamente ficticios (R1/R12). Sin PHI (R3): solo ids opacos.
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { BloqueoRepository } from '../src/agenda/bloqueo.repository.js';
import {
  actualizarBloqueo,
  crearBloqueo,
  eliminarBloqueo,
  listarBloqueos,
} from '../src/agenda/bloqueo.service.js';
import { createApp } from '../src/shared/app.js';
import { puedeGestionarBloqueos, puedeLeerBloqueos } from '../src/shared/auth.js';
import { BloqueoError } from '../src/shared/errors.js';
import { openDatabase } from '../src/shared/repository.js';
import type {
  BloqueoId,
  ProfesionalId,
  SillonId,
  TurnoId,
} from '../src/shared/types.js';
import {
  APP_CONFIG,
  bearer,
  PAC,
  PROF,
  PROF2,
  resetSecuencia,
  seedBase as seedBaseCompartido,
  sembrarBloqueo as sembrarBloqueoCompartido,
  sembrarTurno as sembrarTurnoCompartido,
  SILLA,
  SILLA2,
  type BloqueoFixture,
  type TurnoFixture,
} from './helpers/agenda-fixtures.js';

// ── Fixtures ficticios compartidos (R1/R12, task 6.4) ──────────────────────
let db: DatabaseSync;

function sembrarTurno(args: TurnoFixture): TurnoId {
  return sembrarTurnoCompartido(db, args);
}

function sembrarBloqueo(args: BloqueoFixture): BloqueoId {
  return sembrarBloqueoCompartido(db, args);
}

beforeEach(() => {
  resetSecuencia();
  db = openDatabase(':memory:');
  seedBaseCompartido(db);
});

afterEach(() => {
  db.close();
});

// ── 3.1 RED: escritura, lectura vigente y listado ───────────────────────────
describe('Dado un BloqueoRepository sobre SQLite real Cuando creo un bloqueo', () => {
  it('Entonces persiste los campos y buscarVigente lo recupera', () => {
    // Dado
    const repo = new BloqueoRepository(db);
    const id = 'bloq-creado-0001' as BloqueoId;

    // Cuando
    repo.crear({
      id,
      profesionalId: PROF as ProfesionalId,
      sillonId: null,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T12:00:00.000Z',
      motivo: 'vacaciones ficticias',
    });

    // Entonces
    const row = repo.buscarVigente(id);
    expect(row).toBeDefined();
    expect(row?.id).toBe(id);
    expect(row?.profesional_id).toBe(PROF);
    expect(row?.sillon_id).toBeNull();
    expect(row?.motivo).toBe('vacaciones ficticias');
    expect(repo.countAll()).toBe(1);
  });

  it('Entonces buscarVigente no devuelve un bloqueo dado de baja lógica', () => {
    // Dado
    const repo = new BloqueoRepository(db);
    const id = sembrarBloqueo({
      prof: PROF,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T12:00:00.000Z',
    });

    // Cuando
    expect(repo.bajaLogica(id)).toBe(true);

    // Entonces: la fila sigue existiendo, pero no vigente
    expect(repo.findById(id)).toBeDefined();
    expect(repo.buscarVigente(id)).toBeUndefined();
  });

  it('Entonces actualizar cambia el rango y devuelve false si no existe', () => {
    // Dado
    const repo = new BloqueoRepository(db);
    const id = sembrarBloqueo({
      prof: PROF,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T12:00:00.000Z',
    });

    // Cuando
    const ok = repo.actualizar(id, {
      fin: '2026-10-07T13:00:00.000Z',
      motivo: 'motivo editado ficticio',
    });

    // Entonces
    expect(ok).toBe(true);
    const row = repo.buscarVigente(id);
    expect(row?.fin).toBe('2026-10-07T13:00:00.000Z');
    expect(row?.motivo).toBe('motivo editado ficticio');
    expect(
      repo.actualizar('bloq-inexistente' as BloqueoId, { motivo: 'x' }),
    ).toBe(false);
  });
});

// ── 3.1 RED: listado con filtros ────────────────────────────────────────────
describe('Dado un conjunto de bloqueos vigentes Cuando listo con filtros', () => {
  it('Entonces filtra por profesional_id y excluye los dados de baja', () => {
    // Dado
    const p1a = sembrarBloqueo({
      prof: PROF,
      inicio: '2026-10-07T09:00:00.000Z',
      fin: '2026-10-07T10:00:00.000Z',
    });
    const p1b = sembrarBloqueo({
      prof: PROF,
      inicio: '2026-10-07T12:00:00.000Z',
      fin: '2026-10-07T13:00:00.000Z',
    });
    sembrarBloqueo({
      prof: PROF2,
      inicio: '2026-10-07T09:00:00.000Z',
      fin: '2026-10-07T10:00:00.000Z',
    });
    const repo = new BloqueoRepository(db);
    repo.bajaLogica(p1b);

    // Cuando
    const filas = repo.listar({ profesionalId: PROF });

    // Entonces
    expect(filas.map((f) => f.id)).toEqual([p1a]);
  });

  it('Entonces filtra por sillon_id', () => {
    // Dado
    const s1 = sembrarBloqueo({
      sillon: SILLA,
      inicio: '2026-10-07T09:00:00.000Z',
      fin: '2026-10-07T10:00:00.000Z',
    });
    sembrarBloqueo({
      sillon: SILLA2,
      inicio: '2026-10-07T09:00:00.000Z',
      fin: '2026-10-07T10:00:00.000Z',
    });
    const repo = new BloqueoRepository(db);

    // Cuando
    const filas = repo.listar({ sillonId: SILLA });

    // Entonces
    expect(filas.map((f) => f.id)).toEqual([s1]);
  });

  it('Entonces filtra por rango [desde, hasta) sin contar el contiguo', () => {
    // Dado: uno que termina justo en `desde`, uno dentro del rango
    const contiguoPrevio = sembrarBloqueo({
      inicio: '2026-10-07T09:00:00.000Z',
      fin: '2026-10-07T10:00:00.000Z',
    });
    const dentro = sembrarBloqueo({
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T11:00:00.000Z',
    });
    const contiguoPosterior = sembrarBloqueo({
      inicio: '2026-10-07T11:00:00.000Z',
      fin: '2026-10-07T12:00:00.000Z',
    });
    const repo = new BloqueoRepository(db);

    // Cuando
    const filas = repo.listar({
      desde: '2026-10-07T10:00:00.000Z',
      hasta: '2026-10-07T11:00:00.000Z',
    });

    // Entonces
    expect(filas.map((f) => f.id)).toEqual([dentro]);
    expect(filas.map((f) => f.id)).not.toContain(contiguoPrevio);
    expect(filas.map((f) => f.id)).not.toContain(contiguoPosterior);
  });

  it('Entonces sin filtros devuelve todos los vigentes', () => {
    // Dado
    const a = sembrarBloqueo({
      prof: PROF,
      inicio: '2026-10-07T09:00:00.000Z',
      fin: '2026-10-07T10:00:00.000Z',
    });
    const b = sembrarBloqueo({
      sillon: SILLA2,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T11:00:00.000Z',
    });
    const repo = new BloqueoRepository(db);

    // Cuando
    const filas = repo.listar({});

    // Entonces
    expect(filas.map((f) => f.id).sort()).toEqual([a, b].sort());
  });
});

// ── 3.1 RED: intersección con turnos activos ────────────────────────────────
describe('Dado un bloqueo Cuando calculo los turnos activos en su intersección', () => {
  it('Entonces un bloqueo por profesional solo ve turnos de ese profesional', () => {
    // Dado
    const propios = sembrarTurno({
      prof: PROF,
      sillon: SILLA,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
      estado: 'confirmado',
    });
    sembrarTurno({
      prof: PROF2,
      sillon: SILLA2,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
    });
    const repo = new BloqueoRepository(db);

    // Cuando
    const ids = repo.turnosActivosEnInterseccion(
      PROF,
      null,
      '2026-10-07T09:00:00.000Z',
      '2026-10-07T11:00:00.000Z',
    );

    // Entonces
    expect(ids).toEqual([propios]);
  });

  it('Entonces un bloqueo por sillón solo ve turnos de ese sillón', () => {
    // Dado
    const delSillon = sembrarTurno({
      prof: PROF2,
      sillon: SILLA,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
      estado: 'presente',
    });
    sembrarTurno({
      prof: PROF,
      sillon: SILLA2,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
    });
    const repo = new BloqueoRepository(db);

    // Cuando
    const ids = repo.turnosActivosEnInterseccion(
      null,
      SILLA,
      '2026-10-07T09:00:00.000Z',
      '2026-10-07T11:00:00.000Z',
    );

    // Entonces
    expect(ids).toEqual([delSillon]);
  });

  it('Entonces un bloqueo global ve los turnos de cualquier profesional y sillón', () => {
    // Dado
    const primero = sembrarTurno({
      prof: PROF,
      sillon: SILLA,
      inicio: '2026-10-07T09:30:00.000Z',
      fin: '2026-10-07T10:00:00.000Z',
    });
    const segundo = sembrarTurno({
      prof: PROF2,
      sillon: SILLA2,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
      estado: 'confirmado',
    });
    const repo = new BloqueoRepository(db);

    // Cuando
    const ids = repo.turnosActivosEnInterseccion(
      null,
      null,
      '2026-10-07T09:00:00.000Z',
      '2026-10-07T11:00:00.000Z',
    );

    // Entonces: ordenados por inicio
    expect(ids).toEqual([primero, segundo]);
  });

  it('Entonces ignora turnos no activos y soft-deleted', () => {
    // Dado
    for (const estado of ['cancelado', 'ausente', 'atendido']) {
      sembrarTurno({
        inicio: '2026-10-07T10:00:00.000Z',
        fin: '2026-10-07T10:30:00.000Z',
        estado,
      });
    }
    sembrarTurno({
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
      deletedAt: '2026-10-06T00:00:00.000Z',
    });
    const repo = new BloqueoRepository(db);

    // Cuando
    const ids = repo.turnosActivosEnInterseccion(
      null,
      null,
      '2026-10-07T09:00:00.000Z',
      '2026-10-07T11:00:00.000Z',
    );

    // Entonces
    expect(ids).toEqual([]);
  });

  it('Entonces un turno contiguo no se considera intersección', () => {
    // Dado
    sembrarTurno({
      inicio: '2026-10-07T12:00:00.000Z',
      fin: '2026-10-07T12:30:00.000Z',
    });
    const repo = new BloqueoRepository(db);

    // Cuando
    const ids = repo.turnosActivosEnInterseccion(
      null,
      null,
      '2026-10-07T10:00:00.000Z',
      '2026-10-07T12:00:00.000Z',
    );

    // Entonces
    expect(ids).toEqual([]);
  });
});

// -- 3.3 TRIANGULATE: combinaciones de globabilidad y rango contiguo ---------
describe('Dado un bloqueo con solo profesional Cuando calculo la intersecci�n', () => {
  it('Entonces matchea cualquier sill�n de ese profesional y nada de otro', () => {
    // Dado
    const mismoProfOtroSillon = sembrarTurno({
      prof: PROF,
      sillon: SILLA2,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
      estado: 'confirmado',
    });
    sembrarTurno({
      prof: PROF2,
      sillon: SILLA,
      inicio: '2026-10-07T10:15:00.000Z',
      fin: '2026-10-07T10:45:00.000Z',
    });
    const repo = new BloqueoRepository(db);

    // Cuando
    const ids = repo.turnosActivosEnInterseccion(
      PROF,
      null,
      '2026-10-07T09:00:00.000Z',
      '2026-10-07T11:00:00.000Z',
    );

    // Entonces
    expect(ids).toEqual([mismoProfOtroSillon]);
  });
});

describe('Dado un bloqueo con solo sill�n Cuando calculo la intersecci�n', () => {
  it('Entonces matchea cualquier profesional de ese sill�n y nada de otro', () => {
    // Dado
    const otroProfMismoSillon = sembrarTurno({
      prof: PROF2,
      sillon: SILLA,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
      estado: 'presente',
    });
    sembrarTurno({
      prof: PROF,
      sillon: SILLA2,
      inicio: '2026-10-07T10:15:00.000Z',
      fin: '2026-10-07T10:45:00.000Z',
    });
    const repo = new BloqueoRepository(db);

    // Cuando
    const ids = repo.turnosActivosEnInterseccion(
      null,
      SILLA,
      '2026-10-07T09:00:00.000Z',
      '2026-10-07T11:00:00.000Z',
    );

    // Entonces
    expect(ids).toEqual([otroProfMismoSillon]);
  });
});

describe('Dado un bloqueo con profesional y sill�n Cuando calculo la intersecci�n', () => {
  it('Entonces exige ambos campos a la vez', () => {
    // Dado
    const exacto = sembrarTurno({
      prof: PROF,
      sillon: SILLA,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
    });
    sembrarTurno({
      prof: PROF,
      sillon: SILLA2,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
    });
    sembrarTurno({
      prof: PROF2,
      sillon: SILLA,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
    });
    const repo = new BloqueoRepository(db);

    // Cuando
    const ids = repo.turnosActivosEnInterseccion(
      PROF,
      SILLA,
      '2026-10-07T09:00:00.000Z',
      '2026-10-07T11:00:00.000Z',
    );

    // Entonces
    expect(ids).toEqual([exacto]);
  });
});

describe('Dado un rango de listado contiguo a los bloqueos Cuando listo', () => {
  it('Entonces fin == desde e inicio == hasta no matchean', () => {
    // Dado
    sembrarBloqueo({
      inicio: '2026-10-07T09:00:00.000Z',
      fin: '2026-10-07T10:00:00.000Z',
    });
    sembrarBloqueo({
      inicio: '2026-10-07T11:00:00.000Z',
      fin: '2026-10-07T12:00:00.000Z',
    });
    const repo = new BloqueoRepository(db);

    // Cuando
    const filas = repo.listar({
      desde: '2026-10-07T10:00:00.000Z',
      hasta: '2026-10-07T11:00:00.000Z',
    });

    // Entonces
    expect(filas).toEqual([]);
  });
});

// -- 4.1 RED: BloqueoError y matriz RBAC -------------------------------------
describe('Dado un BloqueoError Cuando serializo su cuerpo', () => {
  it('Entonces validacion incluye detalle y conserva el status 400', () => {
    // Dado / Cuando
    const err = new BloqueoError({
      status: 400,
      code: 'validacion',
      message: 'fin debe ser posterior a inicio',
    });

    // Entonces
    expect(err.status).toBe(400);
    expect(err.toBody()).toEqual({
      error: 'validacion',
      detalle: 'fin debe ser posterior a inicio',
    });
  });

  it('Entonces conflicto incluye eje bloqueo y la lista de turno_ids', () => {
    // Dado
    const turnoIds = ['turno-a' as TurnoId, 'turno-b' as TurnoId];

    // Cuando
    const err = new BloqueoError({
      status: 409,
      code: 'conflicto',
      message: 'bloqueo intersecta turnos activos',
      eje: 'bloqueo',
      turnoIds,
    });

    // Entonces
    expect(err.toBody()).toEqual({
      error: 'conflicto',
      eje: 'bloqueo',
      turno_ids: turnoIds,
    });
  });

  it('Entonces not_found expone solo error', () => {
    // Dado / Cuando
    const err = new BloqueoError({
      status: 404,
      code: 'not_found',
      message: 'bloqueo inexistente',
    });

    // Entonces
    expect(err.toBody()).toEqual({ error: 'not_found' });
  });

  it('Entonces forbidden expone solo error', () => {
    // Dado / Cuando
    const err = new BloqueoError({
      status: 403,
      code: 'forbidden',
      message: 'rol sin permiso de bloqueos',
    });

    // Entonces
    expect(err.toBody()).toEqual({ error: 'forbidden' });
  });
});

describe('Dado la matriz RBAC de bloqueos Cuando consulto permisos por rol', () => {
  it('Entonces recepcion y administracion gestionan y leen; profesional no', () => {
    // Dado / Cuando / Entonces
    for (const rol of ['recepcion', 'administracion'] as const) {
      expect(puedeGestionarBloqueos(rol)).toBe(true);
      expect(puedeLeerBloqueos(rol)).toBe(true);
    }
    expect(puedeGestionarBloqueos('profesional')).toBe(false);
    expect(puedeLeerBloqueos('profesional')).toBe(false);
    expect(puedeGestionarBloqueos(undefined)).toBe(false);
    expect(puedeLeerBloqueos(undefined)).toBe(false);
  });
});

// -- 4.3 RED: servicio crearBloqueo/listarBloqueos/actualizarBloqueo/eliminarBloqueo
interface ErrorServicio {
  status: number | undefined;
  eje: string | undefined;
  turnoIds: readonly string[] | undefined;
}

function capturarErrorServicio(fn: () => unknown): ErrorServicio {
  try {
    fn();
  } catch (err) {
    const capturado = err as {
      status?: number;
      eje?: string;
      turnoIds?: readonly string[];
    };
    return {
      status: capturado.status,
      eje: capturado.eje,
      turnoIds: capturado.turnoIds,
    };
  }
  return { status: undefined, eje: undefined, turnoIds: undefined };
}

function sembrarProfesionalInactivo(): string {
  const id = 'prof-inactivo-0001';
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO profesional (id, nombre, activo, created_at, updated_at) VALUES (?, ?, 0, ?, ?)`,
  ).run(id, 'Prof Ficticio Inactivo', now, now);
  return id;
}

describe('Dado el servicio crearBloqueo Cuando el input es valido', () => {
  it('Entonces persiste y devuelve el bloqueo creado', () => {
    // Dado
    const repo = new BloqueoRepository(db);

    // Cuando
    const creado = crearBloqueo(db, {
      profesionalId: PROF,
      sillonId: null,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T12:00:00.000Z',
      motivo: 'vacaciones ficticias',
      rol: 'recepcion',
    });

    // Entonces
    expect(creado.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(creado.profesionalId).toBe(PROF);
    expect(creado.sillonId).toBeNull();
    expect(creado.inicio).toBe('2026-10-07T10:00:00.000Z');
    expect(creado.fin).toBe('2026-10-07T12:00:00.000Z');
    expect(creado.motivo).toBe('vacaciones ficticias');
    expect(repo.countAll()).toBe(1);
  });
});

describe('Dado el servicio crearBloqueo Cuando la entrada es invalida', () => {
  it('Entonces fin <= inicio responde 400 y no persiste', () => {
    // Dado
    const repo = new BloqueoRepository(db);

    // Cuando
    const err = capturarErrorServicio(() =>
      crearBloqueo(db, {
        profesionalId: PROF,
        sillonId: null,
        inicio: '2026-10-07T12:00:00.000Z',
        fin: '2026-10-07T11:00:00.000Z',
        rol: 'recepcion',
      }),
    );

    // Entonces
    expect(err.status).toBe(400);
    expect(repo.countAll()).toBe(0);
  });

  it('Entonces una fecha sin zona horaria responde 400', () => {
    // Dado
    const repo = new BloqueoRepository(db);

    // Cuando
    const err = capturarErrorServicio(() =>
      crearBloqueo(db, {
        profesionalId: PROF,
        sillonId: null,
        inicio: '2026-10-07T10:00:00',
        fin: '2026-10-07T12:00:00.000Z',
        rol: 'recepcion',
      }),
    );

    // Entonces
    expect(err.status).toBe(400);
    expect(repo.countAll()).toBe(0);
  });

  it('Entonces un profesional inexistente responde 400', () => {
    // Dado
    const repo = new BloqueoRepository(db);

    // Cuando
    const err = capturarErrorServicio(() =>
      crearBloqueo(db, {
        profesionalId: 'prof-inexistente-0001',
        sillonId: null,
        inicio: '2026-10-07T10:00:00.000Z',
        fin: '2026-10-07T12:00:00.000Z',
        rol: 'recepcion',
      }),
    );

    // Entonces
    expect(err.status).toBe(400);
    expect(repo.countAll()).toBe(0);
  });

  it('Entonces un profesional inactivo responde 400', () => {
    // Dado
    const inactivo = sembrarProfesionalInactivo();
    const repo = new BloqueoRepository(db);

    // Cuando
    const err = capturarErrorServicio(() =>
      crearBloqueo(db, {
        profesionalId: inactivo,
        sillonId: null,
        inicio: '2026-10-07T10:00:00.000Z',
        fin: '2026-10-07T12:00:00.000Z',
        rol: 'recepcion',
      }),
    );

    // Entonces
    expect(err.status).toBe(400);
    expect(repo.countAll()).toBe(0);
  });

  it('Entonces un rol profesional responde 403 y no persiste', () => {
    // Dado
    const repo = new BloqueoRepository(db);

    // Cuando
    const err = capturarErrorServicio(() =>
      crearBloqueo(db, {
        profesionalId: PROF,
        sillonId: null,
        inicio: '2026-10-07T10:00:00.000Z',
        fin: '2026-10-07T12:00:00.000Z',
        rol: 'profesional',
      }),
    );

    // Entonces
    expect(err.status).toBe(403);
    expect(repo.countAll()).toBe(0);
  });
});

describe('Dado un turno confirmado Cuando creo un bloqueo que lo intersecta', () => {
  it('Entonces responde 409 con turnoIds y no persiste el bloqueo', () => {
    // Dado
    const turnoId = sembrarTurno({
      prof: PROF,
      sillon: SILLA,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
      estado: 'confirmado',
    });
    const repo = new BloqueoRepository(db);

    // Cuando
    const err = capturarErrorServicio(() =>
      crearBloqueo(db, {
        profesionalId: PROF,
        sillonId: null,
        inicio: '2026-10-07T09:00:00.000Z',
        fin: '2026-10-07T11:00:00.000Z',
        rol: 'recepcion',
      }),
    );

    // Entonces
    expect(err.status).toBe(409);
    expect(err.eje).toBe('bloqueo');
    expect(err.turnoIds).toEqual([turnoId]);
    expect(repo.countAll()).toBe(0);
  });
});

describe('Dado un bloqueo y un turno activo Cuando edito el bloqueo sobre el turno', () => {
  it('Entonces responde 409 y deja intacto el bloqueo original', () => {
    // Dado
    const bloqueoId = sembrarBloqueo({
      prof: PROF,
      inicio: '2026-10-07T08:00:00.000Z',
      fin: '2026-10-07T09:00:00.000Z',
    });
    sembrarTurno({
      prof: PROF,
      sillon: SILLA,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T10:30:00.000Z',
      estado: 'reservado',
    });
    const repo = new BloqueoRepository(db);

    // Cuando
    const err = capturarErrorServicio(() =>
      actualizarBloqueo(db, {
        id: bloqueoId,
        inicio: '2026-10-07T09:30:00.000Z',
        fin: '2026-10-07T10:15:00.000Z',
        rol: 'recepcion',
      }),
    );

    // Entonces
    expect(err.status).toBe(409);
    expect(err.eje).toBe('bloqueo');
    const original = repo.buscarVigente(bloqueoId);
    expect(original?.inicio).toBe('2026-10-07T08:00:00.000Z');
    expect(original?.fin).toBe('2026-10-07T09:00:00.000Z');
  });
});

describe('Dado un id inexistente Cuando edito o elimino un bloqueo', () => {
  it('Entonces ambos responden 404 sin crear filas', () => {
    // Dado
    const repo = new BloqueoRepository(db);
    const id = 'bloq-inexistente-0001';

    // Cuando
    const alEditar = capturarErrorServicio(() =>
      actualizarBloqueo(db, {
        id,
        motivo: 'motivo ficticio nuevo',
        rol: 'recepcion',
      }),
    );
    const alEliminar = capturarErrorServicio(() =>
      eliminarBloqueo(db, { id, rol: 'recepcion' }),
    );

    // Entonces
    expect(alEditar.status).toBe(404);
    expect(alEliminar.status).toBe(404);
    expect(repo.countAll()).toBe(0);
  });
});

describe('Dado bloqueos vigentes y uno dado de baja Cuando listo sin filtros', () => {
  it('Entonces devuelve todos los vigentes sin logica por rol', () => {
    // Dado
    const vigenteA = sembrarBloqueo({
      prof: PROF,
      inicio: '2026-10-07T09:00:00.000Z',
      fin: '2026-10-07T10:00:00.000Z',
    });
    const vigenteB = sembrarBloqueo({
      sillon: SILLA2,
      inicio: '2026-10-07T10:00:00.000Z',
      fin: '2026-10-07T11:00:00.000Z',
    });
    const dadoDeBaja = sembrarBloqueo({
      prof: PROF2,
      inicio: '2026-10-07T11:00:00.000Z',
      fin: '2026-10-07T12:00:00.000Z',
    });
    new BloqueoRepository(db).bajaLogica(dadoDeBaja as BloqueoId);

    // Cuando
    const filas = listarBloqueos(db, {});

    // Entonces
    expect(filas.map((f) => f.id).sort()).toEqual([vigenteA, vigenteB].sort());
  });
});

// -- 4.5 TRIANGULATE: motivo nulo, bloqueo global y edicion valida -----------
describe('Dado el servicio crearBloqueo Cuando no envio motivo', () => {
  it('Entonces persiste motivo null sin inventar texto', () => {
    // Dado
    const repo = new BloqueoRepository(db);

    // Cuando
    const creado = crearBloqueo(db, {
      profesionalId: null,
      sillonId: SILLA,
      inicio: '2026-10-09T10:00:00.000Z',
      fin: '2026-10-09T12:00:00.000Z',
      rol: 'administracion',
    });

    // Entonces
    expect(creado.motivo).toBeNull();
    expect(repo.buscarVigente(creado.id)?.motivo).toBeNull();
  });
});

describe('Dado un bloqueo global (ambos NULL) Cuando intersecta un turno cualquiera', () => {
  it('Entonces responde 409 con el turno de otro profesional y sillon', () => {
    // Dado
    const turnoId = sembrarTurno({
      prof: PROF2,
      sillon: SILLA2,
      inicio: '2026-10-09T10:15:00.000Z',
      fin: '2026-10-09T10:45:00.000Z',
      estado: 'presente',
    });
    const repo = new BloqueoRepository(db);

    // Cuando
    const err = capturarErrorServicio(() =>
      crearBloqueo(db, {
        profesionalId: null,
        sillonId: null,
        inicio: '2026-10-09T10:00:00.000Z',
        fin: '2026-10-09T11:00:00.000Z',
        rol: 'recepcion',
      }),
    );

    // Entonces
    expect(err.status).toBe(409);
    expect(err.eje).toBe('bloqueo');
    expect(err.turnoIds).toEqual([turnoId]);
    expect(repo.countAll()).toBe(0);
  });
});

describe('Dado un bloqueo vigente Cuando lo edito a un rango libre', () => {
  it('Entonces devuelve el bloqueo actualizado y conserva el motivo previo', () => {
    // Dado
    const bloqueoId = sembrarBloqueo({
      prof: PROF,
      inicio: '2026-10-09T08:00:00.000Z',
      fin: '2026-10-09T09:00:00.000Z',
    });
    sembrarTurno({
      prof: PROF,
      sillon: SILLA,
      inicio: '2026-10-09T14:00:00.000Z',
      fin: '2026-10-09T14:30:00.000Z',
      estado: 'confirmado',
    });
    const repo = new BloqueoRepository(db);

    // Cuando
    const actualizado = actualizarBloqueo(db, {
      id: bloqueoId,
      inicio: '2026-10-09T10:00:00.000Z',
      fin: '2026-10-09T11:00:00.000Z',
      rol: 'recepcion',
    });

    // Entonces
    expect(actualizado.id).toBe(bloqueoId);
    expect(actualizado.inicio).toBe('2026-10-09T10:00:00.000Z');
    expect(actualizado.fin).toBe('2026-10-09T11:00:00.000Z');
    expect(actualizado.motivo).toBe('motivo ficticio');
    expect(repo.buscarVigente(bloqueoId as BloqueoId)?.fin).toBe(
      '2026-10-09T11:00:00.000Z',
    );
  });
});

// -- 5.1 RED: rutas HTTP /api/bloqueos ---------------------------------------
describe('POST /api/bloqueos', () => {
  it('Entonces responde 201 con los campos en snake_case', async () => {
    // Dado
    const app = createApp(db, APP_CONFIG);

    // Cuando
    const res = await request(app)
      .post('/api/bloqueos')
      .set('authorization', bearer(['recepcion']))
      .send({
        profesional_id: PROF,
        sillon_id: null,
        inicio: '2026-10-10T10:00:00.000Z',
        fin: '2026-10-10T12:00:00.000Z',
        motivo: 'motivo ficticio',
      });

    // Entonces
    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe('string');
    expect(res.body.profesional_id).toBe(PROF);
    expect(res.body.sillon_id).toBeNull();
    expect(res.body.inicio).toBe('2026-10-10T10:00:00.000Z');
    expect(res.body.fin).toBe('2026-10-10T12:00:00.000Z');
    expect(res.body.motivo).toBe('motivo ficticio');
    expect(new BloqueoRepository(db).countAll()).toBe(1);
  });
});

describe('GET /api/bloqueos', () => {
  it('Entonces responde 200 { bloqueos } filtrando por profesional y rango', async () => {
    // Dado
    const dentro = sembrarBloqueo({
      prof: PROF,
      inicio: '2026-10-10T10:00:00.000Z',
      fin: '2026-10-10T11:00:00.000Z',
    });
    sembrarBloqueo({
      prof: PROF2,
      inicio: '2026-10-10T10:00:00.000Z',
      fin: '2026-10-10T11:00:00.000Z',
    });
    sembrarBloqueo({
      prof: PROF,
      inicio: '2026-10-10T13:00:00.000Z',
      fin: '2026-10-10T14:00:00.000Z',
    });
    const app = createApp(db, APP_CONFIG);

    // Cuando
    const res = await request(app)
      .get(
        `/api/bloqueos?profesional_id=${PROF}&desde=2026-10-10T09:00:00.000Z&hasta=2026-10-10T12:00:00.000Z`,
      )
      .set('authorization', bearer(['recepcion']));

    // Entonces
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.bloqueos)).toBe(true);
    expect(res.body.bloqueos.map((b: { id: string }) => b.id)).toEqual([dentro]);
  });

  it('Entonces filtra por sillon_id', async () => {
    // Dado
    const delSillon = sembrarBloqueo({
      sillon: SILLA,
      inicio: '2026-10-10T10:00:00.000Z',
      fin: '2026-10-10T11:00:00.000Z',
    });
    sembrarBloqueo({
      sillon: SILLA2,
      inicio: '2026-10-10T10:00:00.000Z',
      fin: '2026-10-10T11:00:00.000Z',
    });
    const app = createApp(db, APP_CONFIG);

    // Cuando
    const res = await request(app)
      .get(`/api/bloqueos?sillon_id=${SILLA}`)
      .set('authorization', bearer(['administracion']));

    // Entonces
    expect(res.status).toBe(200);
    expect(res.body.bloqueos.map((b: { id: string }) => b.id)).toEqual([
      delSillon,
    ]);
  });

  it('Entonces recepcion y administracion ven todos los vigentes', async () => {
    // Dado: bloqueos de distintos profesionales y un global
    sembrarBloqueo({
      prof: PROF,
      inicio: '2026-10-10T09:00:00.000Z',
      fin: '2026-10-10T10:00:00.000Z',
    });
    sembrarBloqueo({
      prof: PROF2,
      inicio: '2026-10-10T10:00:00.000Z',
      fin: '2026-10-10T11:00:00.000Z',
    });
    sembrarBloqueo({
      inicio: '2026-10-10T11:00:00.000Z',
      fin: '2026-10-10T12:00:00.000Z',
    });
    const app = createApp(db, APP_CONFIG);

    // Cuando
    const comoRecepcion = await request(app)
      .get('/api/bloqueos')
      .set('authorization', bearer(['recepcion']));
    const comoAdmin = await request(app)
      .get('/api/bloqueos')
      .set('authorization', bearer(['administracion']));

    // Entonces
    expect(comoRecepcion.status).toBe(200);
    expect(comoAdmin.status).toBe(200);
    expect(comoRecepcion.body.bloqueos).toHaveLength(3);
    expect(comoAdmin.body.bloqueos).toHaveLength(3);
  });
});

describe('PUT /api/bloqueos/:id', () => {
  it('Entonces responde 200 con el bloqueo actualizado', async () => {
    // Dado
    const id = sembrarBloqueo({
      prof: PROF,
      inicio: '2026-10-10T08:00:00.000Z',
      fin: '2026-10-10T09:00:00.000Z',
    });
    const app = createApp(db, APP_CONFIG);

    // Cuando
    const res = await request(app)
      .put(`/api/bloqueos/${id}`)
      .set('authorization', bearer(['recepcion']))
      .send({
        inicio: '2026-10-10T10:00:00.000Z',
        fin: '2026-10-10T11:00:00.000Z',
      });

    // Entonces
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.inicio).toBe('2026-10-10T10:00:00.000Z');
    expect(res.body.fin).toBe('2026-10-10T11:00:00.000Z');
  });

  it('Entonces responde 404 con un id inexistente', async () => {
    // Dado
    const app = createApp(db, APP_CONFIG);

    // Cuando
    const res = await request(app)
      .put('/api/bloqueos/bloq-inexistente-0001')
      .set('authorization', bearer(['recepcion']))
      .send({ motivo: 'motivo ficticio' });

    // Entonces
    expect(res.status).toBe(404);
    expect(new BloqueoRepository(db).countAll()).toBe(0);
  });
});

describe('DELETE /api/bloqueos/:id', () => {
  it('Entonces responde 204 sin cuerpo y conserva la fila con deleted_at', async () => {
    // Dado
    const id = sembrarBloqueo({
      prof: PROF,
      inicio: '2026-10-10T10:00:00.000Z',
      fin: '2026-10-10T12:00:00.000Z',
    });
    const app = createApp(db, APP_CONFIG);

    // Cuando
    const res = await request(app)
      .delete(`/api/bloqueos/${id}`)
      .set('authorization', bearer(['recepcion']));

    // Entonces
    expect(res.status).toBe(204);
    expect(res.text ?? '').toBe('');
    const repo = new BloqueoRepository(db);
    expect(repo.findById(id)).toBeDefined();
    expect(repo.buscarVigente(id as BloqueoId)).toBeUndefined();
  });

  it('Entonces responde 404 en una segunda baja', async () => {
    // Dado
    const id = sembrarBloqueo({
      prof: PROF,
      inicio: '2026-10-10T10:00:00.000Z',
      fin: '2026-10-10T12:00:00.000Z',
    });
    const app = createApp(db, APP_CONFIG);
    await request(app)
      .delete(`/api/bloqueos/${id}`)
      .set('authorization', bearer(['recepcion']));

    // Cuando
    const res = await request(app)
      .delete(`/api/bloqueos/${id}`)
      .set('authorization', bearer(['recepcion']));

    // Entonces
    expect(res.status).toBe(404);
  });
});

describe('Dado un usuario profesional Cuando toca /api/bloqueos', () => {
  it('Entonces recibe 403 en POST, GET, PUT y DELETE sin modificar bloqueos', async () => {
    // Dado
    const id = sembrarBloqueo({
      prof: PROF,
      inicio: '2026-10-10T10:00:00.000Z',
      fin: '2026-10-10T12:00:00.000Z',
    });
    const app = createApp(db, APP_CONFIG);
    const auth = bearer(['profesional']);

    // Cuando
    const post = await request(app)
      .post('/api/bloqueos')
      .set('authorization', auth)
      .send({
        profesional_id: PROF,
        inicio: '2026-10-11T10:00:00.000Z',
        fin: '2026-10-11T12:00:00.000Z',
      });
    const get = await request(app)
      .get('/api/bloqueos')
      .set('authorization', auth);
    const put = await request(app)
      .put(`/api/bloqueos/${id}`)
      .set('authorization', auth)
      .send({ motivo: 'intento ficticio' });
    const del = await request(app)
      .delete(`/api/bloqueos/${id}`)
      .set('authorization', auth);

    // Entonces
    expect([post.status, get.status, put.status, del.status]).toEqual([
      403, 403, 403, 403,
    ]);
    const repo = new BloqueoRepository(db);
    expect(repo.countAll()).toBe(1);
    expect(repo.buscarVigente(id as BloqueoId)).toBeDefined();
  });
});

describe('Dado un request sin token Cuando toca /api/bloqueos', () => {
  it('Entonces responde 401', async () => {
    // Dado
    const app = createApp(db, APP_CONFIG);

    // Cuando
    const get = await request(app).get('/api/bloqueos');
    const post = await request(app).post('/api/bloqueos').send({});

    // Entonces
    expect(get.status).toBe(401);
    expect(post.status).toBe(401);
  });
});

describe('Dado un bloqueo que intersecta un turno confirmado Cuando lo creo por HTTP', () => {
  it('Entonces responde 409 con turno_ids y sin PHI', async () => {
    // Dado
    const turnoId = sembrarTurno({
      prof: PROF,
      sillon: SILLA,
      inicio: '2026-10-10T10:00:00.000Z',
      fin: '2026-10-10T10:30:00.000Z',
      estado: 'confirmado',
    });
    const app = createApp(db, APP_CONFIG);

    // Cuando
    const res = await request(app)
      .post('/api/bloqueos')
      .set('authorization', bearer(['recepcion']))
      .send({
        profesional_id: PROF,
        inicio: '2026-10-10T09:00:00.000Z',
        fin: '2026-10-10T11:00:00.000Z',
      });

    // Entonces
    expect(res.status).toBe(409);
    expect(res.body.eje).toBe('bloqueo');
    expect(res.body.turno_ids).toEqual([turnoId]);
    expect(JSON.stringify(res.body)).not.toMatch(
      /Ficticio|Paciente|DNI|dni|historia/i,
    );
    expect(new BloqueoRepository(db).countAll()).toBe(0);
  });
});

// -- 5.3 TRIANGULATE: query invalida y token ausente --------------------------
describe('Dado una query de fechas invalida Cuando listo bloqueos por HTTP', () => {
  it('Entonces desde sin zona horaria responde 400 validacion', async () => {
    // Dado
    const app = createApp(db, APP_CONFIG);

    // Cuando
    const res = await request(app)
      .get('/api/bloqueos?desde=2026-10-10T10:00:00')
      .set('authorization', bearer(['recepcion']));

    // Entonces
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validacion');
    expect(typeof res.body.detalle).toBe('string');
  });

  it('Entonces hasta con formato invalido responde 400', async () => {
    // Dado
    const app = createApp(db, APP_CONFIG);

    // Cuando
    const res = await request(app)
      .get('/api/bloqueos?hasta=no-es-fecha')
      .set('authorization', bearer(['administracion']));

    // Entonces
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validacion');
  });
});

describe('Dado un request sin token Cuando edito o elimino un bloqueo', () => {
  it('Entonces PUT y DELETE responden 401 sin tocar la fila', async () => {
    // Dado
    const id = sembrarBloqueo({
      prof: PROF,
      inicio: '2026-10-10T10:00:00.000Z',
      fin: '2026-10-10T12:00:00.000Z',
    });
    const app = createApp(db, APP_CONFIG);

    // Cuando
    const put = await request(app)
      .put(`/api/bloqueos/${id}`)
      .send({ motivo: 'intento ficticio' });
    const del = await request(app).delete(`/api/bloqueos/${id}`);

    // Entonces
    expect(put.status).toBe(401);
    expect(del.status).toBe(401);
    expect(
      new BloqueoRepository(db).buscarVigente(id as BloqueoId)?.motivo,
    ).toBe('motivo ficticio');
  });
});
