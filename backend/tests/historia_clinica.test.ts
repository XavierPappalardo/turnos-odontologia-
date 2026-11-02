/**
 * C-09 task 6.1: HistoriaClinicaRepository.
 * insert, listado por `ocurrido_en` e `id`, `findById`, `existeEnmiendaDe`,
 * `perteneceAPaciente`. SQLite real en memoria (R12).
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { HistoriaClinicaRepository } from '../src/clinica/historiaClinica.repository.js';

let db: DatabaseSync;
let repo: HistoriaClinicaRepository;

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = new HistoriaClinicaRepository(db);
  // Insertar usuario y profesional requeridos por FK
  db.prepare(
    `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at)
     VALUES ('prof-1', 'Prof Ficticio', 'MAT-1', 'Odonto', 1, ?, ?)`,
  ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
  db.prepare(
    `INSERT INTO usuario (id, email, password_hash, activo, profesional_id, created_at, updated_at, deleted_at)
     VALUES ('user-1', 'u@example.test', 'hash', 1, 'prof-1', ?, ?, null)`,
  ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
  db.prepare(
    `INSERT INTO paciente (id, nombre, activo, created_at, updated_at, deleted_at)
     VALUES ('pac-1', 'Paciente Ficticio', 1, ?, ?, null)`,
  ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
});

afterEach(() => {
  db.close();
});

describe('HistoriaClinicaRepository', () => {
  it('Dado evento Cuando inserta Entonces findById lo recupera', () => {
    repo.insertar({
      id: 'evt-1',
      paciente_id: 'pac-1',
      turno_id: null,
      tipo: 'consulta',
      detalle: 'detalle ficticio',
      ocurrido_en: '2026-11-01T10:00:00.000Z',
      actor_usuario_id: 'user-1',
      profesional_id: 'prof-1',
      created_at: '2026-11-01T10:00:00.000Z',
    });
    const evt = repo.findById('evt-1');
    expect(evt).toBeDefined();
    expect(evt!.tipo).toBe('consulta');
    expect(evt!.detalle).toBe('detalle ficticio');
  });

  it('Dado varios eventos Cuando lista Entonces ordena por ocurrido_en asc, id asc', () => {
    repo.insertar({
      id: 'evt-2',
      paciente_id: 'pac-1',
      turno_id: null,
      tipo: 'consulta',
      detalle: 'b',
      ocurrido_en: '2026-11-01T11:00:00.000Z',
      actor_usuario_id: 'user-1',
      profesional_id: 'prof-1',
      created_at: '2026-11-01T11:00:00.000Z',
    });
    repo.insertar({
      id: 'evt-1',
      paciente_id: 'pac-1',
      turno_id: null,
      tipo: 'consulta',
      detalle: 'a',
      ocurrido_en: '2026-11-01T10:00:00.000Z',
      actor_usuario_id: 'user-1',
      profesional_id: 'prof-1',
      created_at: '2026-11-01T10:00:00.000Z',
    });
    repo.insertar({
      id: 'evt-1b',
      paciente_id: 'pac-1',
      turno_id: null,
      tipo: 'nota',
      detalle: 'c',
      ocurrido_en: '2026-11-01T10:00:00.000Z',
      actor_usuario_id: 'user-1',
      profesional_id: 'prof-1',
      created_at: '2026-11-01T10:00:00.000Z',
    });
    const eventos = repo.listarPorPaciente('pac-1');
    expect(eventos.length).toBe(3);
    expect(eventos[0]!.id).toBe('evt-1');
    expect(eventos[1]!.id).toBe('evt-1b');
    expect(eventos[2]!.id).toBe('evt-2');
  });

  it('Dado evento con enmienda_de Cuando existeEnmiendaDe Entonces true', () => {
    repo.insertar({
      id: 'evt-orig',
      paciente_id: 'pac-1',
      turno_id: null,
      tipo: 'consulta',
      detalle: 'original',
      ocurrido_en: '2026-11-01T10:00:00.000Z',
      actor_usuario_id: 'user-1',
      profesional_id: 'prof-1',
      created_at: '2026-11-01T10:00:00.000Z',
    });
    repo.insertar({
      id: 'evt-enm',
      paciente_id: 'pac-1',
      turno_id: null,
      tipo: 'consulta',
      detalle: 'enmienda',
      ocurrido_en: '2026-11-01T10:00:00.000Z',
      actor_usuario_id: 'user-1',
      profesional_id: 'prof-1',
      enmienda_de: 'evt-orig',
      motivo_enmienda: 'corrección',
      created_at: '2026-11-01T11:00:00.000Z',
    });
    expect(repo.existeEnmiendaDe('evt-orig')).toBe(true);
    expect(repo.existeEnmiendaDe('evt-enm')).toBe(false);
  });

  it('Dado evento de otro paciente Cuando perteneceAPaciente Entonces false', () => {
    repo.insertar({
      id: 'evt-1',
      paciente_id: 'pac-1',
      turno_id: null,
      tipo: 'consulta',
      detalle: 'detalle ficticio',
      ocurrido_en: '2026-11-01T10:00:00.000Z',
      actor_usuario_id: 'user-1',
      profesional_id: 'prof-1',
      created_at: '2026-11-01T10:00:00.000Z',
    });
    expect(repo.perteneceAPaciente('evt-1', 'pac-1')).toBe(true);
    expect(repo.perteneceAPaciente('evt-1', 'pac-otro')).toBe(false);
  });
});
