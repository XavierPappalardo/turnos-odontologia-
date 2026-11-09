/**
 * C-14 tasks 2.1/2.3/4.1/4.3 — reporte de ocupación.
 *
 * Repositorio: agregados mínimos sobre SQLite REAL en memoria (R12), ventana
 * gruesa del design D4 y filtros por dimensión. Servicio: minutos absolutos,
 * estados que ocupan agenda, filtro fino por día local y bucketing.
 * Fixtures ficticios (R1/R12), escenarios `Dado/Cuando/Entonces` (R11).
 */
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { TurnoRepository } from '../src/agenda/turno.repository.js';
import { ReportesRepository } from '../src/reportes/reportes.repository.js';
import { ventanaUtcGruesa } from '../src/reportes/periodo.js';
import { ErrorPeriodoInvalido } from '../src/reportes/periodo.js';
import { crearServicioOcupacion } from '../src/reportes/ocupacion.service.js';
import {
  insertarProfesional,
  insertarSillon,
  seedReportesBase,
  sembrarTurno,
  ZONA_TEST,
} from './helpers/reportes-fixtures.js';

const RANGO = { desde: '2026-11-01', hasta: '2026-11-07' } as const;

function nuevoRepo() {
  const db = openDatabase(':memory:');
  seedReportesBase(db);
  return { db, repo: new ReportesRepository(db) };
}

describe('ReportesRepository — ocupación (task 2.1)', () => {
  it('Dado un turno en la ventana Cuando consulto ocupacionEnVentana Entonces devuelve sólo profesional_id, sillon_id, inicio, fin y estado', () => {
    const { db, repo } = nuevoRepo();
    sembrarTurno(db, {
      id: 'turno-min',
      inicio: '2026-11-02T13:00:00.000Z',
      fin: '2026-11-02T13:30:00.000Z',
    });
    const { desdeUtc, hastaUtc } = ventanaUtcGruesa(RANGO.desde, RANGO.hasta);

    const filas = repo.ocupacionEnVentana(desdeUtc, hastaUtc);

    expect(filas).toHaveLength(1);
    expect(Object.keys(filas[0] ?? {}).sort()).toEqual([
      'estado',
      'fin',
      'inicio',
      'profesional_id',
      'sillon_id',
    ]);
    expect(filas[0]).toMatchObject({
      profesional_id: 'prof-a',
      sillon_id: 'sillon-a',
      estado: 'confirmado',
    });
  });

  it('Dado turnos cancelado y ausente Cuando consulto ocupacionEnVentana Entonces no se devuelven (el filtro de estado vive en el SQL)', () => {
    const { db, repo } = nuevoRepo();
    sembrarTurno(db, {
      id: 'turno-cancelado',
      inicio: '2026-11-02T13:00:00.000Z',
      fin: '2026-11-02T14:00:00.000Z',
      estado: 'cancelado',
    });
    sembrarTurno(db, {
      id: 'turno-ausente',
      inicio: '2026-11-03T13:00:00.000Z',
      fin: '2026-11-03T13:45:00.000Z',
      estado: 'ausente',
    });
    sembrarTurno(db, {
      id: 'turno-reservado',
      inicio: '2026-11-04T13:00:00.000Z',
      fin: '2026-11-04T13:30:00.000Z',
      estado: 'reservado',
    });
    const { desdeUtc, hastaUtc } = ventanaUtcGruesa(RANGO.desde, RANGO.hasta);

    const filas = repo.ocupacionEnVentana(desdeUtc, hastaUtc);

    expect(filas.map((f) => f.estado)).toEqual(['reservado']);
  });

  it('Dado un turno con deleted_at Cuando consulto ocupacionEnVentana Entonces se excluye', () => {
    const { db, repo } = nuevoRepo();
    sembrarTurno(db, {
      id: 'turno-borrado',
      inicio: '2026-11-02T13:00:00.000Z',
      fin: '2026-11-02T14:00:00.000Z',
      estado: 'atendido',
    });
    new TurnoRepository(db).softDelete('turno-borrado');
    const { desdeUtc, hastaUtc } = ventanaUtcGruesa(RANGO.desde, RANGO.hasta);

    expect(repo.ocupacionEnVentana(desdeUtc, hastaUtc)).toEqual([]);
  });
});

describe('ReportesRepository — filtros y bordes de ocupación (task 2.3)', () => {
  it('Dado turnos de dos profesionales Cuando filtro por profesional_id Entonces sólo devuelve ese profesional', () => {
    const db = openDatabase(':memory:');
    seedReportesBase(db);
    db.prepare(
      `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at)
       VALUES ('prof-b', 'Profesional Ficticio B', 'MN-prof-b', 'Odontología', 1, ?, ?)`,
    ).run(new Date().toISOString(), new Date().toISOString());
    sembrarTurno(db, {
      id: 'turno-a',
      inicio: '2026-11-02T13:00:00.000Z',
      fin: '2026-11-02T13:30:00.000Z',
      profesionalId: 'prof-a',
    });
    sembrarTurno(db, {
      id: 'turno-b',
      inicio: '2026-11-02T15:00:00.000Z',
      fin: '2026-11-02T16:00:00.000Z',
      profesionalId: 'prof-b',
    });
    const repo = new ReportesRepository(db);
    const { desdeUtc, hastaUtc } = ventanaUtcGruesa(RANGO.desde, RANGO.hasta);

    const filas = repo.ocupacionEnVentana(desdeUtc, hastaUtc, {
      profesionalId: 'prof-b',
    });

    expect(filas).toHaveLength(1);
    expect(filas[0]?.profesional_id).toBe('prof-b');
  });

  it('Dado turnos de dos sillones Cuando filtro por sillon_id Entonces sólo devuelve ese sillón', () => {
    const db = openDatabase(':memory:');
    seedReportesBase(db);
    db.prepare(
      `INSERT INTO sillon (id, nombre, activo, created_at, updated_at)
       VALUES ('sillon-b', 'Sillón Ficticio B', 1, ?, ?)`,
    ).run(new Date().toISOString(), new Date().toISOString());
    sembrarTurno(db, {
      id: 'turno-sa',
      inicio: '2026-11-02T13:00:00.000Z',
      fin: '2026-11-02T13:30:00.000Z',
      sillonId: 'sillon-a',
    });
    sembrarTurno(db, {
      id: 'turno-sb',
      inicio: '2026-11-02T15:00:00.000Z',
      fin: '2026-11-02T16:00:00.000Z',
      sillonId: 'sillon-b',
    });
    const repo = new ReportesRepository(db);
    const { desdeUtc, hastaUtc } = ventanaUtcGruesa(RANGO.desde, RANGO.hasta);

    const filas = repo.ocupacionEnVentana(desdeUtc, hastaUtc, {
      sillonId: 'sillon-b',
    });

    expect(filas).toHaveLength(1);
    expect(filas[0]?.sillon_id).toBe('sillon-b');
  });

  it('Dado un turno exactamente en el borde inferior Cuando consulto la ventana gruesa Entonces se incluye; en el borde superior Entonces se excluye', () => {
    const { db, repo } = nuevoRepo();
    const { desdeUtc, hastaUtc } = ventanaUtcGruesa(RANGO.desde, RANGO.hasta);
    sembrarTurno(db, {
      id: 'turno-borde-inferior',
      inicio: desdeUtc,
      fin: '2026-10-31T00:30:00.000Z',
    });
    sembrarTurno(db, {
      id: 'turno-borde-superior',
      inicio: hastaUtc,
      fin: '2026-11-09T00:30:00.000Z',
    });

    const filas = repo.ocupacionEnVentana(desdeUtc, hastaUtc);

    expect(filas.map((f) => f.inicio)).toEqual([desdeUtc]);
  });

  it('Dado un rango sin turnos Cuando consulto ocupacionEnVentana Entonces devuelve un array vacío (nunca undefined)', () => {
    const { repo } = nuevoRepo();
    const { desdeUtc, hastaUtc } = ventanaUtcGruesa('2030-01-01', '2030-01-07');

    const filas = repo.ocupacionEnVentana(desdeUtc, hastaUtc);

    expect(filas).toEqual([]);
  });
});

/* ── Servicio de ocupación (tasks 4.1/4.3) ── */

function nuevoServicio() {
  const db = openDatabase(':memory:');
  seedReportesBase(db);
  const repo = new ReportesRepository(db);
  const servicio = crearServicioOcupacion({
    repo,
    zonaHoraria: ZONA_TEST,
  });
  return { db, repo, servicio };
}

describe('ocupacion.service — minutos y estados (task 4.1)', () => {
  it('Dado tres turnos de 30, 90 y 60 minutos activos Cuando calculo la ocupación Entonces el total es 180 minutos y 3 turnos', () => {
    const { db, servicio } = nuevoServicio();
    sembrarTurno(db, {
      id: 'turno-30',
      inicio: '2026-11-02T13:00:00.000Z',
      fin: '2026-11-02T13:30:00.000Z',
      estado: 'confirmado',
    });
    sembrarTurno(db, {
      id: 'turno-90',
      inicio: '2026-11-02T14:00:00.000Z',
      fin: '2026-11-02T15:30:00.000Z',
      estado: 'presente',
    });
    sembrarTurno(db, {
      id: 'turno-60',
      inicio: '2026-11-02T16:00:00.000Z',
      fin: '2026-11-02T17:00:00.000Z',
      estado: 'atendido',
    });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'dia' });

    expect(reporte.total).toEqual({ turnos: 3, minutos_ocupados: 180 });
    expect(reporte.series).toEqual([
      { clave: '2026-11-02', turnos: 3, minutos_ocupados: 180 },
    ]);
  });

  it('Dado un turno cancelado de 60 y uno confirmado de 30 Cuando calculo Entonces sólo cuenta el confirmado', () => {
    const { db, servicio } = nuevoServicio();
    sembrarTurno(db, {
      id: 'turno-cancelado-2',
      inicio: '2026-11-02T13:00:00.000Z',
      fin: '2026-11-02T14:00:00.000Z',
      estado: 'cancelado',
    });
    sembrarTurno(db, {
      id: 'turno-confirmado-2',
      inicio: '2026-11-02T14:00:00.000Z',
      fin: '2026-11-02T14:30:00.000Z',
      estado: 'confirmado',
    });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'dia' });

    expect(reporte.total).toEqual({ turnos: 1, minutos_ocupados: 30 });
  });

  it('Dado un turno ausente Cuando calculo Entonces no aparece en total ni en desgloses', () => {
    const { db, servicio } = nuevoServicio();
    sembrarTurno(db, {
      id: 'turno-ausente-2',
      inicio: '2026-11-02T13:00:00.000Z',
      fin: '2026-11-02T13:45:00.000Z',
      estado: 'ausente',
    });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'dia' });

    expect(reporte.total).toEqual({ turnos: 0, minutos_ocupados: 0 });
    expect(reporte.por_profesional).toEqual([]);
    expect(reporte.por_sillon).toEqual([]);
  });

  it('Dado un turno atendido con deleted_at Cuando calculo Entonces no se contabiliza', () => {
    const { db, servicio } = nuevoServicio();
    sembrarTurno(db, {
      id: 'turno-borrado-2',
      inicio: '2026-11-02T13:00:00.000Z',
      fin: '2026-11-02T14:00:00.000Z',
      estado: 'atendido',
    });
    new TurnoRepository(db).softDelete('turno-borrado-2');

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'dia' });

    expect(reporte.total).toEqual({ turnos: 0, minutos_ocupados: 0 });
  });

  it('Dado un turno de 40 minutos cuya prestación dura 30 Cuando calculo Entonces contabiliza 40 minutos de inicio/fin', () => {
    const { db, servicio } = nuevoServicio();
    sembrarTurno(db, {
      id: 'turno-40',
      inicio: '2026-11-02T13:00:00.000Z',
      fin: '2026-11-02T13:40:00.000Z',
      estado: 'confirmado',
    });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'dia' });

    expect(reporte.total.minutos_ocupados).toBe(40);
  });

  it('Dado un rango sin turnos Cuando calculo Entonces el total es cero y los arrays están vacíos', () => {
    const { servicio } = nuevoServicio();

    const reporte = servicio.calcular({
      desde: '2030-01-01',
      hasta: '2030-01-07',
      granularidad: 'dia',
    });

    expect(reporte.total).toEqual({ turnos: 0, minutos_ocupados: 0 });
    expect(reporte.series).toEqual([]);
    expect(reporte.por_profesional).toEqual([]);
    expect(reporte.por_sillon).toEqual([]);
  });

  it('Dado cualquier consulta Cuando calculo Entonces la respuesta incluye la zona horaria aplicada y el rango pedido', () => {
    const { servicio } = nuevoServicio();

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'semana' });

    expect(reporte).toMatchObject({
      desde: '2026-11-01',
      hasta: '2026-11-07',
      granularidad: 'semana',
      zona_horaria: ZONA_TEST,
    });
  });
});

describe('ocupacion.service — bucketing local (task 4.1)', () => {
  it('Dado un turno a las 2026-11-02T02:30:00.000Z Cuando consulto el 2026-11-01 Entonces cae en la clave 2026-11-01', () => {
    const { db, servicio } = nuevoServicio();
    sembrarTurno(db, {
      id: 'turno-medianoche',
      inicio: '2026-11-02T02:30:00.000Z',
      fin: '2026-11-02T03:00:00.000Z',
      estado: 'confirmado',
    });

    const reporte = servicio.calcular({
      desde: '2026-11-01',
      hasta: '2026-11-01',
      granularidad: 'dia',
    });

    expect(reporte.total).toEqual({ turnos: 1, minutos_ocupados: 30 });
    expect(reporte.series).toEqual([
      { clave: '2026-11-01', turnos: 1, minutos_ocupados: 30 },
    ]);
  });

  it('Dado el mismo turno de 02:30Z Cuando consulto el 2026-11-02 Entonces el total es 0', () => {
    const { db, servicio } = nuevoServicio();
    sembrarTurno(db, {
      id: 'turno-medianoche-2',
      inicio: '2026-11-02T02:30:00.000Z',
      fin: '2026-11-02T03:00:00.000Z',
      estado: 'confirmado',
    });

    const reporte = servicio.calcular({
      desde: '2026-11-02',
      hasta: '2026-11-02',
      granularidad: 'dia',
    });

    expect(reporte.total.turnos).toBe(0);
  });

  it('Dado turnos el lunes y martes Cuando consulto granularidad semana Entonces comparten la clave ISO 2026-W45', () => {
    const { db, servicio } = nuevoServicio();
    sembrarTurno(db, {
      id: 'turno-lunes',
      inicio: '2026-11-02T13:00:00.000Z',
      fin: '2026-11-02T13:30:00.000Z',
    });
    sembrarTurno(db, {
      id: 'turno-martes',
      inicio: '2026-11-03T13:00:00.000Z',
      fin: '2026-11-03T14:00:00.000Z',
    });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'semana' });

    expect(reporte.series).toEqual([
      { clave: '2026-W45', turnos: 2, minutos_ocupados: 90 },
    ]);
  });

  it('Dado turnos en distintos días de noviembre Cuando consulto granularidad mes Entonces hay una única clave 2026-11', () => {
    const { db, servicio } = nuevoServicio();
    sembrarTurno(db, {
      id: 'turno-11-02',
      inicio: '2026-11-02T13:00:00.000Z',
      fin: '2026-11-02T13:30:00.000Z',
    });
    sembrarTurno(db, {
      id: 'turno-11-05',
      inicio: '2026-11-05T13:00:00.000Z',
      fin: '2026-11-05T14:00:00.000Z',
    });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'mes' });

    expect(reporte.series).toEqual([
      { clave: '2026-11', turnos: 2, minutos_ocupados: 90 },
    ]);
  });

  it('Dado turnos en días no consecutivos Cuando consulto granularidad dia Entonces las series no rellenan ceros', () => {
    const { db, servicio } = nuevoServicio();
    sembrarTurno(db, {
      id: 'turno-dia-02',
      inicio: '2026-11-02T13:00:00.000Z',
      fin: '2026-11-02T13:30:00.000Z',
    });
    sembrarTurno(db, {
      id: 'turno-dia-04',
      inicio: '2026-11-04T13:00:00.000Z',
      fin: '2026-11-04T13:30:00.000Z',
    });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'dia' });

    expect(reporte.series.map((s) => s.clave)).toEqual([
      '2026-11-02',
      '2026-11-04',
    ]);
  });

  it('Dado fechas inválidas Cuando calculo Entonces lanza ErrorPeriodoInvalido con el campo desde', () => {
    const { servicio } = nuevoServicio();

    expect(() =>
      servicio.calcular({
        desde: '2026-02-31',
        hasta: '2026-11-07',
        granularidad: 'dia',
      }),
    ).toThrow(ErrorPeriodoInvalido);
  });
});

describe('ocupacion.service — desgloses y filtros (task 4.3)', () => {
  it('Dado dos profesionales y dos sillones Cuando calculo Entonces cada desglose suma el total y se ordena por minutos descendente', () => {
    const db = openDatabase(':memory:');
    seedReportesBase(db);
    insertarProfesional(db, 'prof-b', 'MN-prof-b');
    insertarSillon(db, 'sillon-b');
    // prof-a en sillón-a: 90 minutos.
    sembrarTurno(db, {
      id: 'turno-pa',
      inicio: '2026-11-02T13:00:00.000Z',
      fin: '2026-11-02T14:30:00.000Z',
      profesionalId: 'prof-a',
      sillonId: 'sillon-a',
    });
    // prof-b en sillón-b: 30 minutos.
    sembrarTurno(db, {
      id: 'turno-pb',
      inicio: '2026-11-02T15:00:00.000Z',
      fin: '2026-11-02T15:30:00.000Z',
      profesionalId: 'prof-b',
      sillonId: 'sillon-b',
    });
    const servicio = crearServicioOcupacion({
      repo: new ReportesRepository(db),
      zonaHoraria: ZONA_TEST,
    });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'dia' });

    expect(reporte.total).toEqual({ turnos: 2, minutos_ocupados: 120 });
    expect(reporte.por_profesional).toEqual([
      { profesional_id: 'prof-a', turnos: 1, minutos_ocupados: 90 },
      { profesional_id: 'prof-b', turnos: 1, minutos_ocupados: 30 },
    ]);
    expect(reporte.por_sillon).toEqual([
      { sillon_id: 'sillon-a', turnos: 1, minutos_ocupados: 90 },
      { sillon_id: 'sillon-b', turnos: 1, minutos_ocupados: 30 },
    ]);
    expect(
      reporte.por_profesional.reduce((suma, f) => suma + f.minutos_ocupados, 0),
    ).toBe(reporte.total.minutos_ocupados);
  });

  it('Dado turnos de dos profesionales Cuando filtro por profesional_id Entonces el total y el desglose sólo incluyen ese profesional', () => {
    const { db, servicio } = nuevoServicio();
    insertarProfesional(db, 'prof-b', 'MN-prof-b');
    sembrarTurno(db, {
      id: 'turno-filtro-a',
      inicio: '2026-11-02T13:00:00.000Z',
      fin: '2026-11-02T13:30:00.000Z',
      profesionalId: 'prof-a',
    });
    sembrarTurno(db, {
      id: 'turno-filtro-b',
      inicio: '2026-11-02T15:00:00.000Z',
      fin: '2026-11-02T16:00:00.000Z',
      profesionalId: 'prof-b',
    });

    const reporte = servicio.calcular({
      ...RANGO,
      granularidad: 'dia',
      profesionalId: 'prof-a',
    });

    expect(reporte.total).toEqual({ turnos: 1, minutos_ocupados: 30 });
    expect(reporte.por_profesional).toEqual([
      { profesional_id: 'prof-a', turnos: 1, minutos_ocupados: 30 },
    ]);
  });

  it('Dado turnos de dos sillones Cuando filtro por sillon_id Entonces el total y el desglose sólo incluyen ese sillón', () => {
    const { db, servicio } = nuevoServicio();
    insertarSillon(db, 'sillon-b');
    sembrarTurno(db, {
      id: 'turno-filtro-sa',
      inicio: '2026-11-02T13:00:00.000Z',
      fin: '2026-11-02T13:30:00.000Z',
      sillonId: 'sillon-a',
    });
    sembrarTurno(db, {
      id: 'turno-filtro-sb',
      inicio: '2026-11-02T15:00:00.000Z',
      fin: '2026-11-02T16:00:00.000Z',
      sillonId: 'sillon-b',
    });

    const reporte = servicio.calcular({
      ...RANGO,
      granularidad: 'dia',
      sillonId: 'sillon-b',
    });

    expect(reporte.total).toEqual({ turnos: 1, minutos_ocupados: 60 });
    expect(reporte.por_sillon).toEqual([
      { sillon_id: 'sillon-b', turnos: 1, minutos_ocupados: 60 },
    ]);
  });
});
