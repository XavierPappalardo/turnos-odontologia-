/**
 * C-09 task 5.2: AccesoHcService - esTitular.
 * Un paciente es "suyo" si tiene al menos un turno con el profesional en
 * cualquier estado (incluyendo cancelado). SQLite real en memoria (R12).
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { AccesoHcService } from '../src/clinica/accesoHc.service.js';

let db: DatabaseSync;
let svc: AccesoHcService;

const PROF = 'prof-1';
const PROF_OTRO = 'prof-2';
const PAC_TITULAR = 'pac-1';
const PAC_SIN_TURNO = 'pac-2';
const PAC_OTRO_PROF = 'pac-3';

beforeEach(() => {
  db = openDatabase(':memory:');
  // Insertar profesionales
  db.prepare(
    `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at)
     VALUES (?, ?, 'MAT-1', 'Odonto Ficticia', 1, ?, ?)`,
  ).run(PROF, 'Prof Ficticio 1', '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
  db.prepare(
    `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at)
     VALUES (?, ?, 'MAT-2', 'Odonto Ficticia', 1, ?, ?)`,
  ).run(PROF_OTRO, 'Prof Ficticio 2', '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
  // Insertar sillón requerido por FK de turno
  db.prepare(
    `INSERT INTO sillon (id, nombre, activo, created_at, updated_at)
     VALUES ('sillon-1', 'Sillón Ficticio', 1, ?, ?)`,
  ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
  // Insertar pacientes
  db.prepare(
    `INSERT INTO paciente (id, nombre, activo, created_at, updated_at, deleted_at)
     VALUES (?, ?, 1, ?, ?, null)`,
  ).run(PAC_TITULAR, 'Paciente Titular', '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
  db.prepare(
    `INSERT INTO paciente (id, nombre, activo, created_at, updated_at, deleted_at)
     VALUES (?, ?, 1, ?, ?, null)`,
  ).run(PAC_SIN_TURNO, 'Paciente Sin Turno', '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
  db.prepare(
    `INSERT INTO paciente (id, nombre, activo, created_at, updated_at, deleted_at)
     VALUES (?, ?, 1, ?, ?, null)`,
  ).run(PAC_OTRO_PROF, 'Paciente Otro Prof', '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
  const now = '2026-11-01T10:00:00.000Z';
  // Turno cancelado (habilita acceso por continuidad de atención)
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at, deleted_at)
     VALUES ('turno-cancelado', ?, 'sillon-1', ?, null, '2026-11-02T10:00:00.000Z', '2026-11-02T10:30:00.000Z', 'cancelado', 'recepcion', ?, ?, null)`,
  ).run(PROF, PAC_TITULAR, now, now);
  // Turno de otro profesional con otro paciente
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at, deleted_at)
     VALUES ('turno-otro', ?, 'sillon-1', ?, null, '2026-11-02T11:00:00.000Z', '2026-11-02T11:30:00.000Z', 'reservado', 'recepcion', ?, ?, null)`,
  ).run(PROF_OTRO, PAC_OTRO_PROF, now, now);
  svc = new AccesoHcService(db);
});

afterEach(() => {
  db.close();
});

describe('AccesoHcService.esTitular', () => {
  it('Dado paciente con turno cancelado Cuando esTitular Entonces true (continuidad de atención)', () => {
    expect(svc.esTitular(PAC_TITULAR, PROF)).toBe(true);
  });

  it('Dado paciente sin turno con el profesional Cuando esTitular Entonces false', () => {
    expect(svc.esTitular(PAC_SIN_TURNO, PROF)).toBe(false);
  });

  it('Dado paciente con turno de otro profesional Cuando esTitular Entonces false', () => {
    expect(svc.esTitular(PAC_OTRO_PROF, PROF)).toBe(false);
  });

  it('Dado paciente inexistente Cuando esTitular Entonces false', () => {
    expect(svc.esTitular('pac-inexistente', PROF)).toBe(false);
  });

  it('Dado profesional inexistente Cuando esTitular Entonces false', () => {
    expect(svc.esTitular(PAC_TITULAR, 'prof-inexistente')).toBe(false);
  });
});
