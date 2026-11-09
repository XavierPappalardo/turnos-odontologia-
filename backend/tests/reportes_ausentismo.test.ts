/**
 * C-14 tasks 2.1/2.3/2.4 y 5.1/5.3 — agregados de AUSENTISMO.
 *
 * Primera mitad: escenarios de repositorio (grupo 2). Segunda mitad: escenarios
 * del servicio de ausentismo (grupo 5). SQLite REAL en memoria (R12),
 * fixtures ficticios (R1). `resueltosEnVentana` devuelve filas mínimas de
 * `atendido`/`ausente`; `conteoResueltosEnVentana` expone el conteo equivalente
 * para la spec; `crearServicioAusentismo` deriva la tasa entera (R6) y nula
 * cuando no hay resueltos (design D6).
 */
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { TurnoRepository } from '../src/agenda/turno.repository.js';
import { ReportesRepository } from '../src/reportes/reportes.repository.js';
import { ventanaUtcGruesa } from '../src/reportes/periodo.js';
import { crearServicioAusentismo } from '../src/reportes/ausentismo.service.js';
import {
  insertarProfesional,
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

describe('ReportesRepository — ausentismo (task 2.1)', () => {
  it('Dado turnos en todos los estados Cuando consulto resueltosEnVentana Entonces sólo devuelve atendido y ausente con columnas mínimas', () => {
    const { db, repo } = nuevoRepo();
    const estados = [
      'reservado',
      'confirmado',
      'presente',
      'atendido',
      'cancelado',
      'ausente',
    ] as const;
    estados.forEach((estado, indice) => {
      sembrarTurno(db, {
        id: `turno-${estado}`,
        inicio: `2026-11-0${indice + 1}T13:00:00.000Z`,
        fin: `2026-11-0${indice + 1}T13:30:00.000Z`,
        estado,
      });
    });
    const { desdeUtc, hastaUtc } = ventanaUtcGruesa(RANGO.desde, RANGO.hasta);

    const filas = repo.resueltosEnVentana(desdeUtc, hastaUtc);

    expect(filas.map((f) => f.estado)).toEqual(['atendido', 'ausente']);
    expect(Object.keys(filas[0] ?? {}).sort()).toEqual([
      'estado',
      'fin',
      'inicio',
      'profesional_id',
      'sillon_id',
    ]);
  });

  it('Dado 3 atendidos, 1 ausente, 5 confirmados y 2 reservados Cuando cuento resueltos Entonces el conteo es 4', () => {
    const { db, repo } = nuevoRepo();
    const altas: { estado: 'atendido' | 'ausente' | 'confirmado' | 'reservado'; n: number }[] = [
      { estado: 'atendido', n: 3 },
      { estado: 'ausente', n: 1 },
      { estado: 'confirmado', n: 5 },
      { estado: 'reservado', n: 2 },
    ];
    let indice = 0;
    for (const alta of altas) {
      for (let i = 0; i < alta.n; i += 1) {
        indice += 1;
        sembrarTurno(db, {
          id: `turno-repo-${indice}`,
          inicio: `2026-11-02T${String(8 + indice).padStart(2, '0')}:00:00.000Z`,
          fin: `2026-11-02T${String(8 + indice).padStart(2, '0')}:30:00.000Z`,
          estado: alta.estado,
        });
      }
    }
    const { desdeUtc, hastaUtc } = ventanaUtcGruesa(RANGO.desde, RANGO.hasta);

    expect(repo.conteoResueltosEnVentana(desdeUtc, hastaUtc)).toBe(4);
  });

  it('Dado un turno ausente con deleted_at Cuando cuento resueltos Entonces no se contabiliza', () => {
    const { db, repo } = nuevoRepo();
    sembrarTurno(db, {
      id: 'turno-ausente-borrado',
      inicio: '2026-11-02T13:00:00.000Z',
      fin: '2026-11-02T13:30:00.000Z',
      estado: 'ausente',
    });
    sembrarTurno(db, {
      id: 'turno-atendido-vivo',
      inicio: '2026-11-02T15:00:00.000Z',
      fin: '2026-11-02T15:30:00.000Z',
      estado: 'atendido',
    });
    new TurnoRepository(db).softDelete('turno-ausente-borrado');
    const { desdeUtc, hastaUtc } = ventanaUtcGruesa(RANGO.desde, RANGO.hasta);

    const filas = repo.resueltosEnVentana(desdeUtc, hastaUtc);

    expect(filas).toHaveLength(1);
    expect(filas[0]?.estado).toBe('atendido');
    expect(repo.conteoResueltosEnVentana(desdeUtc, hastaUtc)).toBe(1);
  });
});

describe('ReportesRepository — filtros de ausentismo (task 2.3)', () => {
  it('Dado resueltos de dos profesionales Cuando filtro por profesional_id Entonces sólo cuento los del profesional pedido', () => {
    const { db, repo } = nuevoRepo();
    insertarProfesional(db, 'prof-b', 'MN-prof-b');
    sembrarTurno(db, {
      id: 'turno-a-atendido',
      inicio: '2026-11-02T13:00:00.000Z',
      fin: '2026-11-02T13:30:00.000Z',
      estado: 'atendido',
      profesionalId: 'prof-a',
    });
    sembrarTurno(db, {
      id: 'turno-b-ausente',
      inicio: '2026-11-02T15:00:00.000Z',
      fin: '2026-11-02T15:30:00.000Z',
      estado: 'ausente',
      profesionalId: 'prof-b',
    });
    const { desdeUtc, hastaUtc } = ventanaUtcGruesa(RANGO.desde, RANGO.hasta);

    const filas = repo.resueltosEnVentana(desdeUtc, hastaUtc, {
      profesionalId: 'prof-b',
    });

    expect(filas).toHaveLength(1);
    expect(filas[0]?.profesional_id).toBe('prof-b');
    expect(
      repo.conteoResueltosEnVentana(desdeUtc, hastaUtc, {
        profesionalId: 'prof-b',
      }),
    ).toBe(1);
  });

  it('Dado un rango sin turnos resueltos Cuando consulto el conteo Entonces devuelve 0 y un array vacío', () => {
    const { repo } = nuevoRepo();
    const { desdeUtc, hastaUtc } = ventanaUtcGruesa('2030-01-01', '2030-01-07');

    expect(repo.resueltosEnVentana(desdeUtc, hastaUtc)).toEqual([]);
    expect(repo.conteoResueltosEnVentana(desdeUtc, hastaUtc)).toBe(0);
  });
});

/* ── Servicio de ausentismo (tasks 5.1/5.3) ── */

function nuevoServicio() {
  const db = openDatabase(':memory:');
  seedReportesBase(db);
  const repo = new ReportesRepository(db);
  const servicio = crearServicioAusentismo({
    repo,
    zonaHoraria: ZONA_TEST,
  });
  return { db, repo, servicio };
}

let secuenciaServicio = 0;

/**
 * Siembra turnos `atendido`/`ausente` no solapados dentro del día local
 * indicado. La base es mediodía UTC (mañana en Buenos Aires) y cada turno suma
 * 30 minutos, de modo que hasta 20 turnos caen en el mismo día local.
 */
function sembrarResueltos(
  db: ReturnType<typeof openDatabase>,
  args: {
    readonly fecha: string;
    readonly atendidos?: number;
    readonly ausentes?: number;
    readonly estadoExtra?: 'cancelado' | 'confirmado' | 'reservado';
    readonly estadoExtraCantidad?: number;
    readonly profesionalId?: string;
    readonly inicio?: string;
  },
): void {
  const base = Date.parse(`${args.fecha}T12:00:00.000Z`);
  let indice = 0;
  const sembrar = (
    estado: 'atendido' | 'ausente' | 'cancelado' | 'confirmado' | 'reservado',
    cantidad: number,
    inicioFijo?: string,
  ): void => {
    for (let i = 0; i < cantidad; i += 1) {
      secuenciaServicio += 1;
      const inicioMs = inicioFijo ? Date.parse(inicioFijo) : base + indice * 30 * 60_000;
      indice += 1;
      sembrarTurno(db, {
        id: `turno-servicio-${secuenciaServicio}`,
        inicio: new Date(inicioMs).toISOString(),
        fin: new Date(inicioMs + 30 * 60_000).toISOString(),
        estado,
        ...(args.profesionalId !== undefined
          ? { profesionalId: args.profesionalId }
          : {}),
      });
    }
  };
  sembrar('ausente', args.ausentes ?? 0, args.inicio);
  sembrar('atendido', args.atendidos ?? 0, args.inicio);
  sembrar(args.estadoExtra ?? 'confirmado', args.estadoExtraCantidad ?? 0);
}

describe('ausentismo.service — tasa entera (task 5.1)', () => {
  it('Dado 8 atendidos y 2 ausentes Cuando calculo el período Entonces el total es 2/10 con tasa 20', () => {
    const { db, servicio } = nuevoServicio();
    sembrarResueltos(db, { fecha: '2026-11-02', atendidos: 8, ausentes: 2 });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'dia' });

    expect(reporte.total).toEqual({
      ausentes: 2,
      resueltos: 10,
      tasa_ausentismo_pct: 20,
    });
    expect(reporte.series).toEqual([
      { clave: '2026-11-02', ausentes: 2, resueltos: 10, tasa_ausentismo_pct: 20 },
    ]);
  });

  it('Dado 3 atendidos, 1 ausente, 5 confirmados y 2 reservados Cuando calculo Entonces los abiertos no entran en el denominador', () => {
    const { db, servicio } = nuevoServicio();
    sembrarResueltos(db, { fecha: '2026-11-02', atendidos: 3, ausentes: 1 });
    sembrarResueltos(db, {
      fecha: '2026-11-02',
      estadoExtra: 'confirmado',
      estadoExtraCantidad: 5,
    });
    sembrarResueltos(db, {
      fecha: '2026-11-02',
      estadoExtra: 'reservado',
      estadoExtraCantidad: 2,
    });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'dia' });

    expect(reporte.total).toEqual({
      ausentes: 1,
      resueltos: 4,
      tasa_ausentismo_pct: 25,
    });
  });

  it('Dado 2 cancelados y 1 atendido Cuando calculo Entonces los cancelados quedan fuera de numerador y denominador', () => {
    const { db, servicio } = nuevoServicio();
    sembrarResueltos(db, { fecha: '2026-11-02', atendidos: 1 });
    sembrarResueltos(db, {
      fecha: '2026-11-02',
      estadoExtra: 'cancelado',
      estadoExtraCantidad: 2,
    });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'dia' });

    expect(reporte.total).toEqual({
      ausentes: 0,
      resueltos: 1,
      tasa_ausentismo_pct: 0,
    });
  });

  it('Dado un rango sin turnos resueltos Cuando calculo Entonces la tasa es null y los arrays están vacíos', () => {
    const { servicio } = nuevoServicio();

    const reporte = servicio.calcular({
      desde: '2030-01-01',
      hasta: '2030-01-07',
      granularidad: 'dia',
    });

    expect(reporte.total).toEqual({
      ausentes: 0,
      resueltos: 0,
      tasa_ausentismo_pct: null,
    });
    expect(reporte.series).toEqual([]);
    expect(reporte.por_profesional).toEqual([]);
  });

  it('Dado 1 ausente y 7 atendidos Cuando calculo Entonces la tasa 12,5 % redondea half-up a 13', () => {
    const { db, servicio } = nuevoServicio();
    sembrarResueltos(db, { fecha: '2026-11-02', atendidos: 7, ausentes: 1 });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'dia' });

    expect(reporte.total.tasa_ausentismo_pct).toBe(13);
  });

  it('Dado 1 ausente y 15 atendidos Cuando calculo Entonces la tasa 6,25 % redondea half-up a 6', () => {
    const { db, servicio } = nuevoServicio();
    sembrarResueltos(db, { fecha: '2026-11-02', atendidos: 15, ausentes: 1 });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'dia' });

    expect(reporte.total.tasa_ausentismo_pct).toBe(6);
  });

  it('Dado 3 ausentes y 0 atendidos Cuando calculo Entonces la tasa es 100', () => {
    const { db, servicio } = nuevoServicio();
    sembrarResueltos(db, { fecha: '2026-11-02', atendidos: 0, ausentes: 3 });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'dia' });

    expect(reporte.total).toEqual({
      ausentes: 3,
      resueltos: 3,
      tasa_ausentismo_pct: 100,
    });
  });

  it('Dado 4 atendidos y 0 ausentes Cuando calculo Entonces la tasa es 0 y no null', () => {
    const { db, servicio } = nuevoServicio();
    sembrarResueltos(db, { fecha: '2026-11-02', atendidos: 4, ausentes: 0 });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'dia' });

    expect(reporte.total).toEqual({
      ausentes: 0,
      resueltos: 4,
      tasa_ausentismo_pct: 0,
    });
  });

  it('Dado dos días con tasas distintas Cuando calculo granularidad dia Entonces cada bucket lleva su propia tasa', () => {
    const { db, servicio } = nuevoServicio();
    sembrarResueltos(db, { fecha: '2026-11-01', atendidos: 9, ausentes: 1 });
    sembrarResueltos(db, { fecha: '2026-11-02', atendidos: 1, ausentes: 1 });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'dia' });

    expect(reporte.series).toEqual([
      { clave: '2026-11-01', ausentes: 1, resueltos: 10, tasa_ausentismo_pct: 10 },
      { clave: '2026-11-02', ausentes: 1, resueltos: 2, tasa_ausentismo_pct: 50 },
    ]);
  });

  it('Dado un turno ausente a las 2026-11-02T02:30Z Cuando calculo el 2026-11-01 Entonces se agrupa en el día local 2026-11-01', () => {
    const { db, servicio } = nuevoServicio();
    sembrarResueltos(db, {
      fecha: '2026-11-01',
      ausentes: 1,
      inicio: '2026-11-02T02:30:00.000Z',
    });

    const reporte = servicio.calcular({
      desde: '2026-11-01',
      hasta: '2026-11-01',
      granularidad: 'dia',
    });

    expect(reporte.series).toEqual([
      { clave: '2026-11-01', ausentes: 1, resueltos: 1, tasa_ausentismo_pct: 100 },
    ]);
  });

  it('Dado cualquier consulta Cuando calculo Entonces la respuesta incluye rango, granularidad y zona horaria', () => {
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

describe('ausentismo.service — desglose y buckets (task 5.3)', () => {
  it('Dado el profesional A con 2 ausentes de 20 y el B con 0 de 5 Cuando calculo Entonces cada uno lleva su propia tasa', () => {
    const { db, servicio } = nuevoServicio();
    insertarProfesional(db, 'prof-b', 'MN-prof-b');
    sembrarResueltos(db, {
      fecha: '2026-11-02',
      atendidos: 18,
      ausentes: 2,
      profesionalId: 'prof-a',
    });
    sembrarResueltos(db, {
      fecha: '2026-11-02',
      atendidos: 5,
      ausentes: 0,
      profesionalId: 'prof-b',
    });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'dia' });

    expect(reporte.por_profesional).toEqual([
      {
        profesional_id: 'prof-a',
        ausentes: 2,
        resueltos: 20,
        tasa_ausentismo_pct: 10,
      },
      {
        profesional_id: 'prof-b',
        ausentes: 0,
        resueltos: 5,
        tasa_ausentismo_pct: 0,
      },
    ]);
    expect(reporte.total).toEqual({
      ausentes: 2,
      resueltos: 25,
      tasa_ausentismo_pct: 8,
    });
  });

  it('Dado un día del rango con sólo cancelados Cuando calculo granularidad dia Entonces ese día no aparece en series', () => {
    const { db, servicio } = nuevoServicio();
    sembrarResueltos(db, { fecha: '2026-11-02', atendidos: 2, ausentes: 0 });
    sembrarResueltos(db, {
      fecha: '2026-11-03',
      estadoExtra: 'cancelado',
      estadoExtraCantidad: 3,
    });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'dia' });

    expect(reporte.series.map((serie) => serie.clave)).toEqual(['2026-11-02']);
  });

  it('Dado un rango vacío Cuando calculo Entonces total en ceros, tasa null y desgloses vacíos', () => {
    const { servicio } = nuevoServicio();

    const reporte = servicio.calcular({
      desde: '2026-12-01',
      hasta: '2026-12-31',
      granularidad: 'mes',
    });

    expect(reporte.total).toEqual({
      ausentes: 0,
      resueltos: 0,
      tasa_ausentismo_pct: null,
    });
    expect(reporte.series).toEqual([]);
    expect(reporte.por_profesional).toEqual([]);
  });

  it('Dado un filtro por profesional Cuando calculo Entonces total y desglose sólo incluyen a ese profesional', () => {
    const { db, servicio } = nuevoServicio();
    insertarProfesional(db, 'prof-b', 'MN-prof-b');
    sembrarResueltos(db, {
      fecha: '2026-11-02',
      atendidos: 4,
      ausentes: 1,
      profesionalId: 'prof-a',
    });
    sembrarResueltos(db, {
      fecha: '2026-11-02',
      atendidos: 6,
      ausentes: 0,
      profesionalId: 'prof-b',
    });

    const reporte = servicio.calcular({
      ...RANGO,
      granularidad: 'dia',
      profesionalId: 'prof-b',
    });

    expect(reporte.total).toEqual({
      ausentes: 0,
      resueltos: 6,
      tasa_ausentismo_pct: 0,
    });
    expect(reporte.por_profesional.map((p) => p.profesional_id)).toEqual([
      'prof-b',
    ]);
  });
});


