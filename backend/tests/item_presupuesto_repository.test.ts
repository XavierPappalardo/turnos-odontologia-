/**
 * Task 3.2: ItemPresupuestoRepository - Dado/Cuando/Entonces.
 * SQLite REAL en memoria (R12). Datos ficticios (R1/R12).
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import {
  ItemPresupuestoRepository,
  PresupuestoRepository,
} from '../src/clinica/presupuestos.repository.js';

let db: DatabaseSync;
let itemRepo: ItemPresupuestoRepository;
let presRepo: PresupuestoRepository;

function seedBase(db: DatabaseSync): void {
  const now = '2026-11-01T10:00:00.000Z';
  db.prepare(
    `INSERT INTO profesional (id, nombre, activo, created_at, updated_at) VALUES ('prof-1', 'Prof Ficticio', 1, ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO sillon (id, nombre, activo, created_at, updated_at) VALUES ('sillon-1', 'Sillon Ficticio', 1, ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO paciente (id, nombre, obra_social_plan_id, activo, created_at, updated_at) VALUES ('pac-1', 'Paciente Ficticio', NULL, 1, ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO obra_social_plan (id, obra_social, plan, cobertura_pct, activo, created_at, updated_at) VALUES ('plan-1', 'OS Ficticia', 'Plan Ficticio', 60, 1, ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at) VALUES ('turno-1', 'prof-1', 'sillon-1', 'pac-1', '2026-11-01T10:00:00.000Z', '2026-11-01T10:30:00.000Z', 'reservado', 'recepcion', ?, ?)`,
  ).run(now, now);
}

function crearPresupuesto(db: DatabaseSync, id = 'presup-1'): void {
  db.prepare(
    `INSERT INTO presupuesto (id, paciente_id, turno_id, estado, total_centavos, cobertura_centavos, saldo_centavos, obra_social_plan_id, created_at, updated_at) VALUES (?, 'pac-1', NULL, 'borrador', 0, 0, 0, NULL, '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z')`,
  ).run(id);
}

beforeEach(() => {
  db = openDatabase(':memory:');
  seedBase(db);
  presRepo = new PresupuestoRepository(db);
  itemRepo = new ItemPresupuestoRepository(db);
  crearPresupuesto(db);
});

afterEach(() => {
  db.close();
});

describe('ItemPresupuestoRepository', () => {
  it('Dado ítem nuevo Cuando insertar Entonces se persiste y findByPresupuesto lo devuelve', () => {
    itemRepo.insertar({
      id: 'item-1',
      presupuesto_id: 'presup-1',
      descripcion: 'Consulta ficticia',
      monto_centavos: 50000,
      pieza_fdi: null,
      superficie: null,
    });
    const items = itemRepo.findByPresupuesto('presup-1');
    expect(items).toHaveLength(1);
    expect(items[0].descripcion).toBe('Consulta ficticia');
    expect(items[0].monto_centavos).toBe(50000);
  });

  it('Dado dos ítems Cuando findByPresupuesto Entonces devuelve ambos ordenados', () => {
    itemRepo.insertar({
      id: 'item-1',
      presupuesto_id: 'presup-1',
      descripcion: 'Item A ficticio',
      monto_centavos: 30000,
      pieza_fdi: null,
      superficie: null,
    });
    itemRepo.insertar({
      id: 'item-2',
      presupuesto_id: 'presup-1',
      descripcion: 'Item B ficticio',
      monto_centavos: 20000,
      pieza_fdi: null,
      superficie: null,
    });
    const items = itemRepo.findByPresupuesto('presup-1');
    expect(items).toHaveLength(2);
    expect(items[0].descripcion).toBe('Item A ficticio');
    expect(items[1].descripcion).toBe('Item B ficticio');
  });

  it('Dado ítem con pieza_fdi y superficie Cuando insertar Entonces se persisten', () => {
    itemRepo.insertar({
      id: 'item-1',
      presupuesto_id: 'presup-1',
      descripcion: 'Obturación ficticia',
      monto_centavos: 25000,
      pieza_fdi: 16,
      superficie: 'O',
    });
    const items = itemRepo.findByPresupuesto('presup-1');
    expect(items[0].pieza_fdi).toBe(16);
    expect(items[0].superficie).toBe('O');
  });

  it('Dado presupuesto inexistente Cuando findByPresupuesto Entonces devuelve vacío', () => {
    const items = itemRepo.findByPresupuesto('presup-inexistente');
    expect(items).toHaveLength(0);
  });

  it('Dado ítem Cuando softDeleteItemsPresupuesto Entonces items no aparecen en findByPresupuesto', () => {
    itemRepo.insertar({
      id: 'item-1',
      presupuesto_id: 'presup-1',
      descripcion: 'Item ficticio',
      monto_centavos: 10000,
      pieza_fdi: null,
      superficie: null,
    });
    itemRepo.softDeleteItemsPresupuesto('presup-1');
    const items = itemRepo.findByPresupuesto('presup-1');
    expect(items).toHaveLength(0);
  });
});
