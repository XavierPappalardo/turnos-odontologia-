/**
 * C-09 task 7.1: OdontogramaRepository.
 * insert, estado actual con ROW_NUMBER (último no enmendado, desempate por id),
 * historial por pieza, eventos enmendados excluidos. SQLite real en memoria (R12).
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { OdontogramaRepository } from '../src/clinica/odontograma.repository.js';

let db: DatabaseSync;
let repo: OdontogramaRepository;

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = new OdontogramaRepository(db);
  // Seed FKs
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
  db.prepare(
    `INSERT INTO sillon (id, nombre, activo, created_at, updated_at)
     VALUES ('sillon-1', 'Sillon Ficticio', 1, ?, ?)`,
  ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at, deleted_at)
     VALUES ('turno-1', 'prof-1', 'sillon-1', 'pac-1', null, '2026-11-01T10:00:00.000Z', '2026-11-01T10:30:00.000Z', 'reservado', 'recepcion', ?, ?, null)`,
  ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
});

afterEach(() => {
  db.close();
});

describe('OdontogramaRepository', () => {
  it('Dado evento Cuando inserta Entonces findById lo recupera', () => {
    repo.insertar({
      id: 'evt-1',
      paciente_id: 'pac-1',
      turno_id: 'turno-1',
      pieza_fdi: 16,
      superficie: 'O',
      hallazgo: 'caries',
      ocurrido_en: '2026-11-01T10:00:00.000Z',
      actor_usuario_id: 'user-1',
      profesional_id: 'prof-1',
      created_at: '2026-11-01T10:00:00.000Z',
    });
    const evt = repo.findById('evt-1');
    expect(evt).toBeDefined();
    expect(evt!.pieza_fdi).toBe(16);
    expect(evt!.superficie).toBe('O');
    expect(evt!.hallazgo).toBe('caries');
  });

  it('Dado varios eventos en misma superficie Cuando estado actual Entonces gana el más reciente', () => {
    repo.insertar({
      id: 'evt-1',
      paciente_id: 'pac-1',
      turno_id: null,
      pieza_fdi: 16,
      superficie: 'O',
      hallazgo: 'caries',
      ocurrido_en: '2026-11-01T10:00:00.000Z',
      actor_usuario_id: 'user-1',
      profesional_id: 'prof-1',
      created_at: '2026-11-01T10:00:00.000Z',
    });
    repo.insertar({
      id: 'evt-2',
      paciente_id: 'pac-1',
      turno_id: null,
      pieza_fdi: 16,
      superficie: 'O',
      hallazgo: 'obturado',
      ocurrido_en: '2026-11-02T10:00:00.000Z',
      actor_usuario_id: 'user-1',
      profesional_id: 'prof-1',
      created_at: '2026-11-01T11:00:00.000Z',
    });
    const estado = repo.estadoActual('pac-1');
    const hallazgo16O = estado.find((e) => e.pieza_fdi === 16 && e.superficie === 'O');
    expect(hallazgo16O!.hallazgo).toBe('obturado');
    expect(hallazgo16O!.evento_id).toBe('evt-2');
  });

  it('Dado dos eventos mismo instante Cuando estado actual Entonces desempate por id mayor', () => {
    repo.insertar({
      id: 'evt-a',
      paciente_id: 'pac-1',
      turno_id: null,
      pieza_fdi: 16,
      superficie: 'O',
      hallazgo: 'caries',
      ocurrido_en: '2026-11-01T10:00:00.000Z',
      actor_usuario_id: 'user-1',
      profesional_id: 'prof-1',
      created_at: '2026-11-01T10:00:00.000Z',
    });
    repo.insertar({
      id: 'evt-b',
      paciente_id: 'pac-1',
      turno_id: null,
      pieza_fdi: 16,
      superficie: 'O',
      hallazgo: 'obturado',
      ocurrido_en: '2026-11-01T10:00:00.000Z',
      actor_usuario_id: 'user-1',
      profesional_id: 'prof-1',
      created_at: '2026-11-01T11:00:00.000Z',
    });
    const estado = repo.estadoActual('pac-1');
    const hallazgo16O = estado.find((e) => e.pieza_fdi === 16 && e.superficie === 'O');
    expect(hallazgo16O!.hallazgo).toBe('obturado');
    expect(hallazgo16O!.evento_id).toBe('evt-b');
  });

  it('Dado evento enmendado Cuando estado actual Entonces el enmendado queda excluido', () => {
    repo.insertar({
      id: 'evt-orig',
      paciente_id: 'pac-1',
      turno_id: null,
      pieza_fdi: 16,
      superficie: 'O',
      hallazgo: 'caries',
      ocurrido_en: '2026-11-01T10:00:00.000Z',
      actor_usuario_id: 'user-1',
      profesional_id: 'prof-1',
      created_at: '2026-11-01T10:00:00.000Z',
    });
    repo.insertar({
      id: 'evt-enm',
      paciente_id: 'pac-1',
      turno_id: null,
      pieza_fdi: 26,
      superficie: 'O',
      hallazgo: 'obturado',
      ocurrido_en: '2026-11-01T10:00:00.000Z',
      actor_usuario_id: 'user-1',
      profesional_id: 'prof-1',
      enmienda_de: 'evt-orig',
      motivo_enmienda: 'pieza corregida',
      created_at: '2026-11-01T11:00:00.000Z',
    });
    const estado = repo.estadoActual('pac-1');
    // 16-O no tiene eventos vigentes (evt-orig fue enmendado)
    const hallazgo16O = estado.find((e) => e.pieza_fdi === 16 && e.superficie === 'O');
    expect(hallazgo16O).toBeUndefined();
    // 26-O tiene el evento de enmienda
    const hallazgo26O = estado.find((e) => e.pieza_fdi === 26 && e.superficie === 'O');
    expect(hallazgo26O!.hallazgo).toBe('obturado');
    expect(hallazgo26O!.evento_id).toBe('evt-enm');
  });

  it('Dado historial por pieza Cuando consulta Entonces devuelve eventos cronológicos', () => {
    repo.insertar({
      id: 'evt-1',
      paciente_id: 'pac-1',
      turno_id: null,
      pieza_fdi: 16,
      superficie: 'O',
      hallazgo: 'caries',
      ocurrido_en: '2026-11-01T10:00:00.000Z',
      actor_usuario_id: 'user-1',
      profesional_id: 'prof-1',
      created_at: '2026-11-01T10:00:00.000Z',
    });
    repo.insertar({
      id: 'evt-2',
      paciente_id: 'pac-1',
      turno_id: null,
      pieza_fdi: 16,
      superficie: 'O',
      hallazgo: 'obturado',
      ocurrido_en: '2026-11-02T10:00:00.000Z',
      actor_usuario_id: 'user-1',
      profesional_id: 'prof-1',
      created_at: '2026-11-01T11:00:00.000Z',
    });
    const historial = repo.historialPorPieza('pac-1', 16);
    expect(historial.length).toBe(2);
    expect(historial[0]!.hallazgo).toBe('caries');
    expect(historial[1]!.hallazgo).toBe('obturado');
  });

  it('Dado pieza sin eventos Cuando historial Entonces lista vacía', () => {
    const historial = repo.historialPorPieza('pac-1', 16);
    expect(historial).toEqual([]);
  });

  it('Dado evento de otro paciente Cuando estado actual Entonces no aparece', () => {
    db.prepare(
      `INSERT INTO paciente (id, nombre, activo, created_at, updated_at, deleted_at)
       VALUES ('pac-2', 'Paciente Otro', 1, ?, ?, null)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
    repo.insertar({
      id: 'evt-1',
      paciente_id: 'pac-2',
      turno_id: null,
      pieza_fdi: 16,
      superficie: 'O',
      hallazgo: 'caries',
      ocurrido_en: '2026-11-01T10:00:00.000Z',
      actor_usuario_id: 'user-1',
      profesional_id: 'prof-1',
      created_at: '2026-11-01T10:00:00.000Z',
    });
    const estado = repo.estadoActual('pac-1');
    expect(estado.length).toBe(0);
  });

  it('Dado sin filas Cuando estado actual Entonces modelo disperso (vacío)', () => {
    const estado = repo.estadoActual('pac-1');
    expect(estado).toEqual([]);
  });
});
