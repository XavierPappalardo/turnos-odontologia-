/**
 * C-09 task 7.2: OdontogramaService.
 * Validación `esCombinacionValida`, `ocurrido_en` UTC, `turno_id` del paciente,
 * enmienda hereda instante y no pisa evolución posterior. SQLite real en memoria (R12).
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { OdontogramaService } from '../src/clinica/odontograma.service.js';

let db: DatabaseSync;
let svc: OdontogramaService;

beforeEach(() => {
  db = openDatabase(':memory:');
  svc = new OdontogramaService(db);
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

describe('OdontogramaService', () => {
  it('Dado pieza válida y superficie válida Cuando registra Entonces acepta combinación válida', () => {
    const evt = svc.registrarEvento({
      pacienteId: 'pac-1',
      pieza: 16,
      superficie: 'O',
      hallazgo: 'caries',
      ocurridoEn: '2026-11-01T10:00:00-03:00',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
    });
    expect(evt.pieza_fdi).toBe(16);
    expect(evt.superficie).toBe('O');
    expect(evt.es_vigente).toBe(true);
  });

  it('Dado pieza inválida Cuando registra Entonces lanza ValidacionClinicaError 400', () => {
    expect(() =>
      svc.registrarEvento({
        pacienteId: 'pac-1',
        pieza: 19,
        superficie: 'O',
        hallazgo: 'caries',
        ocurridoEn: '2026-11-01T10:00:00-03:00',
        actorUsuarioId: 'user-1',
        profesionalId: 'prof-1',
      }),
    ).toThrowErrorMatchingInlineSnapshot(`
      [ValidacionClinicaError: pieza FDI inválida]
    `);
  });

  it('Dado combinación inválida (I en molar) Cuando registra Entonces lanza ValidacionClinicaError 400', () => {
    expect(() =>
      svc.registrarEvento({
        pacienteId: 'pac-1',
        pieza: 16,
        superficie: 'I',
        hallazgo: 'caries',
        ocurridoEn: '2026-11-01T10:00:00-03:00',
        actorUsuarioId: 'user-1',
        profesionalId: 'prof-1',
      }),
    ).toThrowErrorMatchingInlineSnapshot(`
      [ValidacionClinicaError: combinación pieza-superficie inválida]
    `);
  });

  it('Dado combinación inválida (O en incisivo) Cuando registra Entonces lanza ValidacionClinicaError 400', () => {
    expect(() =>
      svc.registrarEvento({
        pacienteId: 'pac-1',
        pieza: 11,
        superficie: 'O',
        hallazgo: 'caries',
        ocurridoEn: '2026-11-01T10:00:00-03:00',
        actorUsuarioId: 'user-1',
        profesionalId: 'prof-1',
      }),
    ).toThrowErrorMatchingInlineSnapshot(`
      [ValidacionClinicaError: combinación pieza-superficie inválida]
    `);
  });

  it('Dado superficie inválida Cuando registra Entonces lanza ValidacionClinicaError 400', () => {
    expect(() =>
      svc.registrarEvento({
        pacienteId: 'pac-1',
        pieza: 16,
        superficie: 'X',
        hallazgo: 'caries',
        ocurridoEn: '2026-11-01T10:00:00-03:00',
        actorUsuarioId: 'user-1',
        profesionalId: 'prof-1',
      }),
    ).toThrowErrorMatchingInlineSnapshot(`
      [ValidacionClinicaError: superficie inválida]
    `);
  });

  it('Dado hallazgo inválido Cuando registra Entonces lanza ValidacionClinicaError 400', () => {
    expect(() =>
      svc.registrarEvento({
        pacienteId: 'pac-1',
        pieza: 16,
        superficie: 'O',
        hallazgo: 'mancha',
        ocurridoEn: '2026-11-01T10:00:00-03:00',
        actorUsuarioId: 'user-1',
        profesionalId: 'prof-1',
      }),
    ).toThrowErrorMatchingInlineSnapshot(`
      [ValidacionClinicaError: hallazgo inválido]
    `);
  });

  it('Dado ocurrido_en con offset Cuando registra Entonces normaliza a UTC', () => {
    const evt = svc.registrarEvento({
      pacienteId: 'pac-1',
      pieza: 16,
      superficie: 'O',
      hallazgo: 'caries',
      ocurridoEn: '2026-11-01T13:00:00+00:00',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
    });
    expect(evt.ocurrido_en).toBe('2026-11-01T13:00:00.000Z');
  });

  it('Dado turno_id del paciente Cuando registra Entonces conserva turno_id', () => {
    const evt = svc.registrarEvento({
      pacienteId: 'pac-1',
      pieza: 16,
      superficie: 'O',
      hallazgo: 'caries',
      ocurridoEn: '2026-11-01T10:00:00-03:00',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
      turnoId: 'turno-1',
    });
    expect(evt.turno_id).toBe('turno-1');
  });

  it('Dado turno_id de otro paciente Cuando registra Entonces lanza EventoNoEncontradoError 404', () => {
    db.prepare(
      `INSERT INTO paciente (id, nombre, activo, created_at, updated_at, deleted_at)
       VALUES ('pac-2', 'Paciente Otro', 1, ?, ?, null)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
    db.prepare(
      `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at, deleted_at)
       VALUES ('turno-2', 'prof-1', 'sillon-1', 'pac-2', null, '2026-11-01T10:00:00.000Z', '2026-11-01T10:30:00.000Z', 'reservado', 'recepcion', ?, ?, null)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');

    expect(() =>
      svc.registrarEvento({
        pacienteId: 'pac-1',
        pieza: 16,
        superficie: 'O',
        hallazgo: 'caries',
        ocurridoEn: '2026-11-01T10:00:00-03:00',
        actorUsuarioId: 'user-1',
        profesionalId: 'prof-1',
        turnoId: 'turno-2',
      }),
    ).toThrowErrorMatchingInlineSnapshot(`
      [EventoNoEncontradoError: turno no encontrado para este paciente]
    `);
  });

  it('Dado enmienda Cuando registra Entonces hereda ocurrido_en del original', () => {
    const original = svc.registrarEvento({
      pacienteId: 'pac-1',
      pieza: 16,
      superficie: 'O',
      hallazgo: 'caries',
      ocurridoEn: '2026-10-01T10:00:00-03:00',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
    });
    const enmienda = svc.enmendarEvento({
      pacienteId: 'pac-1',
      eventoId: original.id,
      pieza: 26,
      superficie: 'O',
      hallazgo: 'obturado',
      motivoEnmienda: 'pieza corregida',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
    });
    // Hereda ocurrido_en del original (10:00-03:00 = 13:00Z)
    expect(enmienda.ocurrido_en).toBe('2026-10-01T13:00:00.000Z');
    expect(enmienda.enmienda_de).toBe(original.id);
    expect(enmienda.pieza_fdi).toBe(26);
  });

  it('Dado enmienda Cuando lista estado actual Entonces no pisa evolución posterior', () => {
    const e1 = svc.registrarEvento({
      pacienteId: 'pac-1',
      pieza: 16,
      superficie: 'O',
      hallazgo: 'caries',
      ocurridoEn: '2026-10-01T10:00:00-03:00',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
    });
    const e2 = svc.registrarEvento({
      pacienteId: 'pac-1',
      pieza: 16,
      superficie: 'O',
      hallazgo: 'obturado',
      ocurridoEn: '2026-10-02T10:00:00-03:00',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
    });
    // Enmienda de e1 (del 10/01) el 03/03 - hereda 10/01, no pisa el 10/02
    svc.enmendarEvento({
      pacienteId: 'pac-1',
      eventoId: e1.id,
      pieza: 16,
      superficie: 'O',
      hallazgo: 'sano',
      motivoEnmienda: 'corrección',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
    });
    const estado = svc.estadoActual('pac-1');
    const hallazgo16O = estado.find((h) => h.pieza_fdi === 16 && h.superficie === 'O');
    expect(hallazgo16O!.hallazgo).toBe('obturado');
    expect(hallazgo16O!.id).toBe(e2.id);
  });

  it('Dado doble enmienda del mismo evento Cuando intenta enmendar Entonces 409', () => {
    const original = svc.registrarEvento({
      pacienteId: 'pac-1',
      pieza: 16,
      superficie: 'O',
      hallazgo: 'caries',
      ocurridoEn: '2026-10-01T10:00:00-03:00',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
    });
    svc.enmendarEvento({
      pacienteId: 'pac-1',
      eventoId: original.id,
      pieza: 16,
      superficie: 'O',
      hallazgo: 'obturado',
      motivoEnmienda: 'motivo 1',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
    });
    expect(() =>
      svc.enmendarEvento({
        pacienteId: 'pac-1',
        eventoId: original.id,
        pieza: 16,
        superficie: 'O',
        hallazgo: 'sano',
        motivoEnmienda: 'motivo 2',
        actorUsuarioId: 'user-1',
        profesionalId: 'prof-1',
      }),
    ).toThrowErrorMatchingInlineSnapshot(`
      [EnmiendaDuplicadaError: evento ya enmendado]
    `);
  });

  it('Dado evento de otro paciente Cuando intenta enmendar Entonces 404', () => {
    db.prepare(
      `INSERT INTO paciente (id, nombre, activo, created_at, updated_at, deleted_at)
       VALUES ('pac-2', 'Paciente Otro', 1, ?, ?, null)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
    const evtPropio = svc.registrarEvento({
      pacienteId: 'pac-1',
      pieza: 16,
      superficie: 'O',
      hallazgo: 'caries',
      ocurridoEn: '2026-10-01T10:00:00-03:00',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
    });
    expect(() =>
      svc.enmendarEvento({
        pacienteId: 'pac-2',
        eventoId: evtPropio.id,
        pieza: 16,
        superficie: 'O',
        hallazgo: 'sano',
        motivoEnmienda: 'motivo',
        actorUsuarioId: 'user-1',
        profesionalId: 'prof-1',
      }),
    ).toThrowErrorMatchingInlineSnapshot(`
      [EventoNoEncontradoError: evento no encontrado para este paciente]
    `);
  });
});
