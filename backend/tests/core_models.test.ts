/**
 * C-02 core-models: tablas, CHECKs, auditoría, índices, seed y repositorios.
 * SQLite real en memoria (R12), fixtures ficticios (R1/R12), montos enteros (R2/R5).
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ObraSocialPlanRepository } from '../src/core/obraSocialPlan.repository.js';
import { PagoRepository } from '../src/core/pago.repository.js';
import { openDatabase } from '../src/shared/repository.js';
import { SEED_IDS, seedMinimo } from '../src/shared/seed.js';

let db: DatabaseSync;

beforeEach(() => {
  db = openDatabase(':memory:');
  seedMinimo(db);
});

afterEach(() => {
  db.close();
});

function columnas(tabla: string): string[] {
  return (db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[]).map(
    (c) => c.name,
  );
}

function indiceExiste(nombre: string): boolean {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name = ?`)
      .get(nombre) !== undefined
  );
}

const NOW = '2026-10-28T10:00:00.000Z';

function sembrarTurno(id = 'turno-test-0001'): void {
  db.prepare(
    `INSERT INTO turno
       (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'reservado', 'recepcion', ?, ?)`,
  ).run(
    id,
    SEED_IDS.profesional,
    SEED_IDS.sillon,
    SEED_IDS.paciente,
    SEED_IDS.prestacion,
    '2026-10-29T10:00:00.000Z',
    '2026-10-29T10:30:00.000Z',
    NOW,
    NOW,
  );
}

describe('Dado una BD migrada Cuando inspecciono el esquema Entonces existen las entidades core de C-02', () => {
  it('incluye profesional, sillón, paciente, prestación, OS/plan, turno, bloqueo y pago', () => {
    const tablas = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
        .all() as { name: string }[]
    ).map((t) => t.name);
    expect(tablas).toEqual(
      expect.arrayContaining([
        'profesional',
        'sillon',
        'paciente',
        'prestacion',
        'obra_social_plan',
        'turno',
        'bloqueo',
        'pago',
      ]),
    );
  });

  it('AuditMixin: las tablas core exponen created_at, updated_at y deleted_at', () => {
    for (const tabla of [
      'profesional',
      'sillon',
      'paciente',
      'prestacion',
      'obra_social_plan',
      'turno',
      'bloqueo',
      'pago',
    ]) {
      const cols = columnas(tabla);
      expect(cols, tabla).toEqual(
        expect.arrayContaining(['created_at', 'updated_at', 'deleted_at']),
      );
    }
  });

  it('paciente y prestación tienen activo (soft-delete lógico)', () => {
    expect(columnas('paciente')).toContain('activo');
    expect(columnas('prestacion')).toContain('activo');
  });

  it('crea índices de solapamiento y de pagos', () => {
    expect(indiceExiste('idx_turno_prof_intervalo')).toBe(true);
    expect(indiceExiste('idx_turno_sillon_intervalo')).toBe(true);
    expect(indiceExiste('idx_pago_turno')).toBe(true);
  });
});

describe('Dado constraints de C-02 Cuando inserto valores inválidos Entonces SQLite rechaza', () => {
  it('prestación con duracion_min = 0', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO prestacion (id, codigo, nombre, duracion_min, activo, created_at, updated_at)
           VALUES ('p0', 'CERO', 'Ficticia', 0, 1, ?, ?)`,
        )
        .run(NOW, NOW),
    ).toThrow();
  });

  it('turno con fin <= inicio', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at)
           VALUES ('t-bad', ?, ?, ?, '2026-10-29T11:00:00.000Z', '2026-10-29T10:00:00.000Z', 'reservado', 'recepcion', ?, ?)`,
        )
        .run(SEED_IDS.profesional, SEED_IDS.sillon, SEED_IDS.paciente, NOW, NOW),
    ).toThrow();
  });

  it('cobertura_pct fuera de 0..100 o fraccionaria', () => {
    for (const pct of [-1, 101, 50.5]) {
      expect(() =>
        db
          .prepare(
            `INSERT INTO obra_social_plan (id, obra_social, plan, cobertura_pct, activo, created_at, updated_at)
             VALUES (?, 'OS Ficticia', 'Plan Ficticio', ?, 1, ?, ?)`,
          )
          .run(`os-${pct}`, pct, NOW, NOW),
      ).toThrow();
    }
  });

  it('cobertura_pct acepta los bordes 0 y 100', () => {
    for (const pct of [0, 100]) {
      expect(() =>
        db
          .prepare(
            `INSERT INTO obra_social_plan (id, obra_social, plan, cobertura_pct, activo, created_at, updated_at)
             VALUES (?, 'OS Ficticia', ?, ?, 1, ?, ?)`,
          )
          .run(`os-borde-${pct}`, `Plan ${pct}`, pct, NOW, NOW),
      ).not.toThrow();
    }
  });

  it('pago con monto negativo, fraccionario, moneda distinta de ARS o medio inválido', () => {
    sembrarTurno();
    const insert = (id: string, monto: number, moneda: string, medio: string): void => {
      db.prepare(
        `INSERT INTO pago (id, turno_id, monto_centavos, moneda, medio, estado, created_at, updated_at)
         VALUES (?, 'turno-test-0001', ?, ?, ?, 'pendiente', ?, ?)`,
      ).run(id, monto, moneda, medio, NOW, NOW);
    };
    expect(() => insert('pago-neg', -1, 'ARS', 'efectivo')).toThrow();
    expect(() => insert('pago-float', 10.5, 'ARS', 'efectivo')).toThrow();
    expect(() => insert('pago-usd', 100, 'USD', 'efectivo')).toThrow();
    expect(() => insert('pago-medio', 100, 'ARS', 'cheque')).toThrow();
    expect(() => insert('pago-ok', 0, 'ARS', 'efectivo')).not.toThrow();
  });

  it('pago referencia un turno inexistente (FK)', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO pago (id, turno_id, monto_centavos, moneda, medio, estado, created_at, updated_at)
           VALUES ('pago-fk', 'turno-inexistente', 100, 'ARS', 'efectivo', 'pendiente', ?, ?)`,
        )
        .run(NOW, NOW),
    ).toThrow();
  });
});

describe('Dado seed mínimo Cuando lo ejecuto Entonces es idempotente y ficticio', () => {
  it('carga una fila de cada entidad y no duplica al repetir', () => {
    const count = (tabla: string): number =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as { n: number }).n;

    expect(count('profesional')).toBe(1);
    expect(count('sillon')).toBe(1);
    expect(count('paciente')).toBe(1);
    expect(count('prestacion')).toBe(1);
    expect(count('obra_social_plan')).toBe(1);

    seedMinimo(db);
    expect(count('profesional')).toBe(1);
    expect(count('sillon')).toBe(1);
    expect(count('paciente')).toBe(1);
    expect(count('prestacion')).toBe(1);
    expect(count('obra_social_plan')).toBe(1);
  });

  it('los datos son ficticios y el paciente referencia el plan de OS', () => {
    const paciente = db
      .prepare('SELECT * FROM paciente WHERE id = ?')
      .get(SEED_IDS.paciente) as { nombre: string; obra_social_plan_id: string };
    expect(paciente.nombre).toMatch(/Ficticio/i);
    expect(paciente.obra_social_plan_id).toBe(SEED_IDS.obraSocialPlan);
  });
});

describe('Dado repositorios de C-02 Cuando opero Entonces respetan R2/R5/R8', () => {
  it('ObraSocialPlanRepository encuentra por obra social y plan', () => {
    const repo = new ObraSocialPlanRepository(db);
    const plan = repo.buscarPorPlan('Obra Social Ficticia', 'Plan Ficticio 100');
    expect(plan?.cobertura_pct).toBe(100);
  });

  it('PagoRepository suma solo pagos cobrados en centavos', () => {
    sembrarTurno();
    const repo = new PagoRepository(db);
    repo.crear({
      id: 'pago-1',
      turnoId: 'turno-test-0001',
      montoCentavos: 5_000,
      medio: 'efectivo',
      estado: 'cobrado',
    });
    repo.crear({
      id: 'pago-2',
      turnoId: 'turno-test-0001',
      montoCentavos: 2_500,
      medio: 'transferencia',
      estado: 'pendiente',
    });
    expect(repo.totalCobradoPorTurno('turno-test-0001')).toBe(5_000);
    expect(() =>
      repo.crear({
        id: 'pago-float',
        turnoId: 'turno-test-0001',
        montoCentavos: 10.5,
        medio: 'efectivo',
      }),
    ).toThrow();
  });
});
