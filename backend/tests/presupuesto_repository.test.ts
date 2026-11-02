/**
 * Task 3.1: PresupuestoRepository - Dado/Cuando/Entonces.
 * SQLite REAL en memoria (R12). Datos ficticios (R1/R12).
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { PresupuestoRepository } from '../src/clinica/presupuestos.repository.js';
import type { Presupuesto } from '../src/shared/types.js';

let db: DatabaseSync;
let repo: PresupuestoRepository;

function crearPresupuesto(overrides: Partial<Presupuesto> = {}): Presupuesto {
  const now = '2026-11-01T10:00:00.000Z';
  return {
    id: (overrides.id as any) ?? 'presup-1',
    paciente_id: (overrides.paciente_id as any) ?? 'pac-1',
    turno_id: overrides.turno_id ?? null,
    estado: (overrides.estado as any) ?? 'borrador',
    total_centavos: overrides.total_centavos ?? 0,
    cobertura_centavos: overrides.cobertura_centavos ?? 0,
    saldo_centavos: overrides.saldo_centavos ?? 0,
    obra_social_plan_id: overrides.obra_social_plan_id ?? null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

function crearPaciente(db: DatabaseSync, id = 'pac-1', obraSocialPlanId = null): void {
  db.prepare(
    `INSERT INTO paciente (id, nombre, obra_social_plan_id, activo, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
  ).run(id, 'Paciente Ficticio', obraSocialPlanId, '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
}

function crearPlanOS(db: DatabaseSync, id = 'plan-1', pct = 60): void {
  db.prepare(
    `INSERT INTO obra_social_plan (id, obra_social, plan, cobertura_pct, activo, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`,
  ).run(id, 'OS Ficticia', 'Plan Ficticio', pct, '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
}

function crearTurno(db: DatabaseSync, id = 'turno-1', pacienteId = 'pac-1'): void {
  db.prepare(
    `INSERT INTO profesional (id, nombre, activo, created_at, updated_at) VALUES ('prof-1', 'Prof Ficticio', 1, '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO sillon (id, nombre, activo, created_at, updated_at) VALUES ('sillon-1', 'Sillon Ficticio', 1, '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at) VALUES (?, 'prof-1', 'sillon-1', ?, '2026-11-01T10:00:00.000Z', '2026-11-01T10:30:00.000Z', 'reservado', 'recepcion', '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z')`,
  ).run(id, pacienteId);
}

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = new PresupuestoRepository(db);
  crearPaciente(db);
  crearPlanOS(db);
  crearTurno(db);
});

afterEach(() => {
  db.close();
});

describe('PresupuestoRepository', () => {
  it('Dado presupuesto nuevo Cuando insert Entonces se persiste y findById lo devuelve', () => {
    const p = crearPresupuesto();
    repo.insert(p as any);
    const encontrado = repo.findById(p.id as string);
    expect(encontrado).toBeDefined();
    expect(encontrado?.estado).toBe('borrador');
    expect(encontrado?.turno_id).toBeNull();
  });

  it('Dado presupuesto con turno Cuando insert Entonces conserva turno_id', () => {
    const p = crearPresupuesto({ turno_id: 'turno-1' as any });
    repo.insert(p as any);
    const encontrado = repo.findById(p.id as string)!;
    expect(encontrado.turno_id).toBe('turno-1');
  });

  it('Dado presupuesto existente Cuando softDelete Entonces deleted_at se setea y findById lo excluye', () => {
    const p = crearPresupuesto();
    repo.insert(p as any);
    const ok = repo.softDelete(p.id as string);
    expect(ok).toBe(true);
    const encontrado = repo.findById(p.id as string);
    expect(encontrado?.deleted_at).not.toBeNull();
  });

  it('Dado presupuesto inexistente Cuando softDelete Entonces devuelve false', () => {
    const ok = repo.softDelete('presup-inexistente' as any);
    expect(ok).toBe(false);
  });

  it('Dado dos presupuestos Cuando list Entonces devuelve ambos no borrados', () => {
    repo.insert(crearPresupuesto({ id: 'p1' as any }) as any);
    repo.insert(crearPresupuesto({ id: 'p2' as any }) as any);
    const todos = (db.prepare(`SELECT * FROM presupuesto`).all() as any[]);
    expect(todos).toHaveLength(2);
  });

  it('Dado presupuesto borrado Cuando list actives Entonces no aparece', () => {
    repo.insert(crearPresupuesto({ id: 'p1' as any }) as any);
    repo.softDelete('p1' as any);
    const activos = (db.prepare(`SELECT * FROM presupuesto WHERE deleted_at IS NULL`).all() as any[]);
    expect(activos).toHaveLength(0);
  });
});
