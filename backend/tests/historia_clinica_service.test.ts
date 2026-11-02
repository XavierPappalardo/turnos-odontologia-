/**
 * C-09 task 6.2: HistoriaClinicaService.
 * Catálogo de `tipo`, `detalle` 1..5000, `ocurrido_en` normalizado a UTC,
 * `turno_id` del paciente, filtro por turno, `es_vigente`. SQLite real en memoria (R12).
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { HistoriaClinicaService } from '../src/clinica/historiaClinica.service.js';
import type { TipoEventoHc } from '../src/shared/types.js';

let db: DatabaseSync;
let svc: HistoriaClinicaService;

beforeEach(() => {
  db = openDatabase(':memory:');
  svc = new HistoriaClinicaService(db);
  // Seed: profesional, usuario vinculado, paciente, turno
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
  // Sillon needed by FK (turno references sillon)
  db.prepare(
    `INSERT INTO sillon (id, nombre, activo, created_at, updated_at)
     VALUES ('sillon-1', 'Sillon Ficticio', 1, ?, ?)`,
  ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');

  // Turno del paciente con el profesional
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at, deleted_at)
     VALUES ('turno-1', 'prof-1', 'sillon-1', 'pac-1', null, '2026-11-01T10:00:00.000Z', '2026-11-01T10:30:00.000Z', 'reservado', 'recepcion', ?, ?, null)`,
  ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
});

afterEach(() => {
  db.close();
});

describe('HistoriaClinicaService', () => {
  it('Dado tipo válido Cuando registra evento Entonces acepta todo el catálogo', () => {
    for (const tipo of ['consulta', 'nota', 'diagnostico', 'procedimiento']) {
      const evt = svc.registrarEvento({
        pacienteId: 'pac-1',
        tipo: tipo as TipoEventoHc,
        detalle: 'detalle ficticio de prueba',
        ocurridoEn: '2026-11-01T10:00:00-03:00',
        actorUsuarioId: 'user-1',
        profesionalId: 'prof-1',
      });
      expect(evt.tipo).toBe(tipo);
      expect(evt.es_vigente).toBe(true);
    }
  });

  it('Dado tipo fuera de catálogo Cuando registra Entonces lanza ValidacionClinicaError 400', () => {
    expect(() =>
      svc.registrarEvento({
        pacienteId: 'pac-1',
        tipo: 'receta' as never,
        detalle: 'detalle ficticio',
        ocurridoEn: '2026-11-01T10:00:00-03:00',
        actorUsuarioId: 'user-1',
        profesionalId: 'prof-1',
      }),
    ).toThrowErrorMatchingInlineSnapshot(`
      [ValidacionClinicaError: tipo de evento clínico inválido]
    `);
  });

  it('Dado detalle vacío Cuando registra Entonces lanza ValidacionClinicaError 400', () => {
    expect(() =>
      svc.registrarEvento({
        pacienteId: 'pac-1',
        tipo: 'consulta',
        detalle: '',
        ocurridoEn: '2026-11-01T10:00:00-03:00',
        actorUsuarioId: 'user-1',
        profesionalId: 'prof-1',
      }),
    ).toThrowErrorMatchingInlineSnapshot(`
      [ValidacionClinicaError: detalle clínico inválido]
    `);
  });

  it('Dado detalle de 5001 caracteres Cuando registra Entonces lanza ValidacionClinicaError 400', () => {
    expect(() =>
      svc.registrarEvento({
        pacienteId: 'pac-1',
        tipo: 'consulta',
        detalle: 'a'.repeat(5001),
        ocurridoEn: '2026-11-01T10:00:00-03:00',
        actorUsuarioId: 'user-1',
        profesionalId: 'prof-1',
      }),
    ).toThrowErrorMatchingInlineSnapshot(`
      [ValidacionClinicaError: detalle clínico inválido]
    `);
  });

  it('Dado ocurrido_en con offset Cuando registra Entonces normaliza a UTC', () => {
    const evt = svc.registrarEvento({
      pacienteId: 'pac-1',
      tipo: 'consulta',
      detalle: 'detalle ficticio',
      ocurridoEn: '2026-11-01T13:00:00+00:00',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
    });
    expect(evt.ocurrido_en).toBe('2026-11-01T13:00:00.000Z');
  });

  it('Dado ocurrido_en sin zona Cuando registra Entonces lanza ValidacionClinicaError 400', () => {
    expect(() =>
      svc.registrarEvento({
        pacienteId: 'pac-1',
        tipo: 'consulta',
        detalle: 'detalle ficticio',
        ocurridoEn: '2026-11-01T10:00:00',
        actorUsuarioId: 'user-1',
        profesionalId: 'prof-1',
      }),
    ).toThrowErrorMatchingInlineSnapshot(`
      [ValidacionClinicaError: ocurrido_en inválido]
    `);
  });

  it('Dado turno_id del paciente Cuando registra Entonces conserva el turno_id', () => {
    const evt = svc.registrarEvento({
      pacienteId: 'pac-1',
      tipo: 'consulta',
      detalle: 'detalle ficticio',
      ocurridoEn: '2026-11-01T10:00:00-03:00',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
      turnoId: 'turno-1',
    });
    expect(evt.turno_id).toBe('turno-1');
  });

  it('Dado turno_id de otro paciente Cuando registra Entonces lanza EventoNoEncontradoError 404', () => {
    // Otro paciente con su propio turno
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
        tipo: 'consulta',
        detalle: 'detalle ficticio',
        ocurridoEn: '2026-11-01T10:00:00-03:00',
        actorUsuarioId: 'user-1',
        profesionalId: 'prof-1',
        turnoId: 'turno-2',
      }),
    ).toThrowErrorMatchingInlineSnapshot(`
      [EventoNoEncontradoError: turno no encontrado para este paciente]
    `);
  });

  it('Dado lista de eventos Cuando filtra por turno Entonces devuelve solo los de ese turno', () => {
    svc.registrarEvento({
      pacienteId: 'pac-1',
      tipo: 'consulta',
      detalle: 'evento con turno',
      ocurridoEn: '2026-11-01T10:00:00-03:00',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
      turnoId: 'turno-1',
    });
    svc.registrarEvento({
      pacienteId: 'pac-1',
      tipo: 'nota',
      detalle: 'evento sin turno',
      ocurridoEn: '2026-11-01T11:00:00-03:00',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
    });

    const porTurno = svc.listarPorPaciente('pac-1', 'turno-1', 'user-1', 'profesional');
    expect(porTurno.length).toBe(1);
    expect(porTurno[0]!.turno_id).toBe('turno-1');

    const todos = svc.listarPorPaciente('pac-1', undefined, 'user-1', 'profesional');
    expect(todos.length).toBe(2);
  });

  it('Dado evento sin enmienda Cuando lista Entonces es_vigente es true', () => {
    const evt = svc.registrarEvento({
      pacienteId: 'pac-1',
      tipo: 'consulta',
      detalle: 'detalle ficticio',
      ocurridoEn: '2026-11-01T10:00:00-03:00',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
    });
    expect(evt.es_vigente).toBe(true);
  });

  it('Dado enmienda Cuando registra Entonces hereda ocurrido_en del original', () => {
    const original = svc.registrarEvento({
      pacienteId: 'pac-1',
      tipo: 'consulta',
      detalle: 'detalle original',
      ocurridoEn: '2026-10-01T10:00:00-03:00',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
    });
    const enmienda = svc.enmendarEvento({
      pacienteId: 'pac-1',
      eventoId: original.id,
      tipo: 'consulta',
      detalle: 'detalle corregido',
      motivoEnmienda: 'corrección de carga',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
    });
    // Hereda el ocurrido_en del original (diseño D3). 10:00-03:00 = 13:00Z
    expect(enmienda.ocurrido_en).toBe('2026-10-01T13:00:00.000Z');
    expect(enmienda.enmienda_de).toBe(original.id);
    expect(enmienda.motivo_enmienda).toBe('corrección de carga');
  });

  it('Dado enmienda Cuando lista Entonces el original deja de ser vigente', () => {
    const original = svc.registrarEvento({
      pacienteId: 'pac-1',
      tipo: 'consulta',
      detalle: 'detalle original',
      ocurridoEn: '2026-10-01T10:00:00-03:00',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
    });
    svc.enmendarEvento({
      pacienteId: 'pac-1',
      eventoId: original.id,
      tipo: 'consulta',
      detalle: 'detalle corregido',
      motivoEnmienda: 'corrección',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
    });
    const eventos = svc.listarPorPaciente('pac-1', undefined, 'user-1', 'profesional');
    const orig = eventos.find((e) => e.id === original.id);
    const enm = eventos.find((e) => e.enmienda_de === original.id);
    expect(orig!.es_vigente).toBe(false);
    expect(enm!.es_vigente).toBe(true);
    // El original permanece intacto
    expect(orig!.detalle).toBe('detalle original');
  });

  it('Dado doble enmienda del mismo evento Cuando intenta enmendar Entonces 409', () => {
    const original = svc.registrarEvento({
      pacienteId: 'pac-1',
      tipo: 'consulta',
      detalle: 'detalle original',
      ocurridoEn: '2026-10-01T10:00:00-03:00',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
    });
    svc.enmendarEvento({
      pacienteId: 'pac-1',
      eventoId: original.id,
      tipo: 'consulta',
      detalle: 'primera enmienda',
      motivoEnmienda: 'motivo 1',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
    });
    expect(() =>
      svc.enmendarEvento({
        pacienteId: 'pac-1',
        eventoId: original.id,
        tipo: 'consulta',
        detalle: 'segunda enmienda',
        motivoEnmienda: 'motivo 2',
        actorUsuarioId: 'user-1',
        profesionalId: 'prof-1',
      }),
    ).toThrowErrorMatchingInlineSnapshot(`
      [EnmiendaDuplicadaError: evento ya enmendado]
    `);
  });

  it('Dado evento de otro paciente Cuando intenta enmendar Entonces 404', () => {
    // Otro paciente
    db.prepare(
      `INSERT INTO paciente (id, nombre, activo, created_at, updated_at, deleted_at)
       VALUES ('pac-2', 'Paciente Otro', 1, ?, ?, null)`,
    ).run('2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z');
    const evtPropio = svc.registrarEvento({
      pacienteId: 'pac-1',
      tipo: 'consulta',
      detalle: 'detalle propio',
      ocurridoEn: '2026-10-01T10:00:00-03:00',
      actorUsuarioId: 'user-1',
      profesionalId: 'prof-1',
    });
    expect(() =>
      svc.enmendarEvento({
        pacienteId: 'pac-2',
        eventoId: evtPropio.id,
        tipo: 'consulta',
        detalle: 'intento ajeno',
        motivoEnmienda: 'motivo',
        actorUsuarioId: 'user-1',
        profesionalId: 'prof-1',
      }),
    ).toThrowErrorMatchingInlineSnapshot(`
      [EventoNoEncontradoError: evento no encontrado para este paciente]
    `);
  });
});
