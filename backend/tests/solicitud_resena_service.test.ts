/**
 * C-19 solicitud de reseña post-atención: servicio/dominio (BAJO).
 * SQLite real (R12), fixtures ficticias (R1), sin PHI/secretos (R3/R15).
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { seedMinimo, SEED_IDS } from '../src/shared/seed.js';
import { SolicitudResenaService, solicitarResenaSeguro } from '../src/notificaciones/solicitud-resena/service.js';
import { cambiarEstadoTurno } from '../src/agenda/turnoEstado.service.js';
import type { AppConfig } from '../src/shared/config.js';
import { APP_CONFIG } from './helpers/agenda-fixtures.js';

let db: DatabaseSync;

const cfg = (over: Partial<AppConfig['solicitudResena']> = {}): AppConfig => ({
  ...APP_CONFIG,
  solicitudResena: { ...APP_CONFIG.solicitudResena, ...over },
});

function seedTurno(estado: 'reservado' | 'confirmado' | 'presente' | 'atendido', inicio = '2099-11-10T10:00:00.000Z'): string {
  const id = `tur-resena-${estado}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '2099-11-10T10:30:00.000Z', ?, 'recepcion', ?, ?)`,
  ).run(id, SEED_IDS.profesional, SEED_IDS.sillon, SEED_IDS.paciente, inicio, estado, inicio, inicio);
  return id;
}

function filasResena(turnoId: string): Array<{ estado: string; motivo_omision: string | null; canal: string }> {
  return db
    .prepare(`SELECT estado, motivo_omision, canal FROM solicitud_resena WHERE turno_id = ? ORDER BY created_at ASC`)
    .all(turnoId) as Array<{ estado: string; motivo_omision: string | null; canal: string }>;
}

describe('C-19 SolicitudResenaService', () => {
  beforeEach(() => {
    db = openDatabase(':memory:');
    seedMinimo(db);
  });
  afterEach(() => {
    db.close();
  });

  it('Dado turno atendido elegible y config válida Cuando procesa Entonces registra envío simulado sin PHI', () => {
    const turnoId = seedTurno('atendido');
    const svc = new SolicitudResenaService(db, cfg());
    const res = svc.procesarSolicitudParaTurnoAtendido(turnoId, '2099-11-10T10:35:00.000Z');
    expect(res.estado).toBe('enviado_simulado');
    expect(res.turno_id).toBe(turnoId);
    expect(res.canal).toBe('whatsapp');
    expect(res.solicitud_id).toBeTruthy();
    const filas = filasResena(turnoId);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toEqual({ estado: 'enviado_simulado', motivo_omision: null, canal: 'whatsapp' });
    const raw = JSON.stringify(db.prepare('SELECT * FROM solicitud_resena').all());
    expect(raw).not.toMatch(/Paciente Ficticio|Ficticio Ejemplo|nombre|telefono|dni|email@/i);
  });

  it('Dado funcionalidad deshabilitada Cuando procesa turno atendido Entonces omite sin crear envío simulado', () => {
    const turnoId = seedTurno('atendido');
    const svc = new SolicitudResenaService(db, cfg({ habilitado: false }));
    const res = svc.procesarSolicitudParaTurnoAtendido(turnoId);
    expect(res.estado).toBe('omitido');
    expect(res.motivo).toBe('deshabilitado');
    expect(filasResena(turnoId)).toHaveLength(0);
  });

  it('Dado turno no atendido Cuando procesa Entonces omite (no elegible)', () => {
    const turnoId = seedTurno('confirmado');
    const svc = new SolicitudResenaService(db, cfg());
    const res = svc.procesarSolicitudParaTurnoAtendido(turnoId);
    expect(res.estado).toBe('omitido');
    expect(filasResena(turnoId)).toHaveLength(0);
  });

  it('Dado link/config inválida Cuando procesa turno atendido Entonces registra fallo tipado seguro', () => {
    const turnoId = seedTurno('atendido');
    const svc = new SolicitudResenaService(db, cfg({ linkResena: '   ' }));
    const res = svc.procesarSolicitudParaTurnoAtendido(turnoId);
    expect(res.estado).toBe('fallido');
    expect(res.motivo).toBe('config_link_invalida');
    const filas = filasResena(turnoId);
    expect(filas).toHaveLength(1);
    expect(filas[0].estado).toBe('fallido');
    expect(filas[0].motivo_omision).toBe('config_link_invalida');
  });

  it('Dado solicitud ya registrada para el mismo turno Cuando reprocesa Entonces omite duplicado sin duplicar efectiva', () => {
    const turnoId = seedTurno('atendido');
    const svc = new SolicitudResenaService(db, cfg());
    const primero = svc.procesarSolicitudParaTurnoAtendido(turnoId, '2099-11-10T10:35:00.000Z');
    expect(primero.estado).toBe('enviado_simulado');
    const segundo = svc.procesarSolicitudParaTurnoAtendido(turnoId, '2099-11-10T10:40:00.000Z');
    expect(segundo.estado).toBe('omitido');
    expect(segundo.motivo).toBe('duplicado_turno');
    const filas = filasResena(turnoId);
    expect(filas.filter((f) => f.estado === 'enviado_simulado')).toHaveLength(1);
  });

  it('Dado cambiarEstadoTurno a atendido Cuando transiciona válido Entonces dispara solicitud (integración canónica)', () => {
    const turnoId = seedTurno('presente');
    const full = cfg();
    const res = cambiarEstadoTurno(
      db,
      { turnoId, nuevoEstado: 'atendido', rol: 'administracion' },
      { recordatorio: full.recordatorio, solicitudResena: full.solicitudResena },
    );
    expect(res.estado).toBe('atendido');
    expect(filasResena(turnoId).some((f) => f.estado === 'enviado_simulado')).toBe(true);
  });

  it('Dado transición a estado distinto de atendido Cuando cambia Entonces no dispara solicitud', () => {
    const turnoId = seedTurno('reservado');
    const full = cfg();
    cambiarEstadoTurno(
      db,
      { turnoId, nuevoEstado: 'confirmado', rol: 'recepcion' },
      { recordatorio: full.recordatorio, solicitudResena: full.solicitudResena },
    );
    expect(filasResena(turnoId)).toHaveLength(0);
  });

  it('Dado funcionalidad deshabilitada Cuando transiciona a atendido Entonces estado cambia y no crea envío', () => {
    const turnoId = seedTurno('presente');
    const full = cfg({ habilitado: false });
    const res = cambiarEstadoTurno(
      db,
      { turnoId, nuevoEstado: 'atendido', rol: 'administracion' },
      { recordatorio: full.recordatorio, solicitudResena: full.solicitudResena },
    );
    expect(res.estado).toBe('atendido');
    expect(filasResena(turnoId)).toHaveLength(0);
  });

  it('Dado fallo interno de reseña Cuando transiciona a atendido Entonces NO revierte el estado del turno', () => {
    const turnoId = seedTurno('presente');
    const full = cfg();
    db.exec(`CREATE TRIGGER fallo_resena BEFORE INSERT ON solicitud_resena BEGIN SELECT RAISE(ABORT,'fail'); END;`);
    try {
      const res = cambiarEstadoTurno(
        db,
        { turnoId, nuevoEstado: 'atendido', rol: 'administracion' },
        { recordatorio: full.recordatorio, solicitudResena: full.solicitudResena },
      );
      expect(res.estado).toBe('atendido');
      const row = db.prepare('SELECT estado FROM turno WHERE id=?').get(turnoId) as { estado: string };
      expect(row.estado).toBe('atendido');
    } finally {
      db.exec('DROP TRIGGER IF EXISTS fallo_resena;');
    }
  });

  it('Dado listado de solicitudes Cuando se consulta Entonces retorna DTO seguro sin PHI', () => {
    const turnoId = seedTurno('atendido');
    const svc = new SolicitudResenaService(db, cfg());
    svc.procesarSolicitudParaTurnoAtendido(turnoId);
    const out = svc.listarSolicitudes();
    expect(out.solicitudes).toHaveLength(1);
    const raw = JSON.stringify(out);
    expect(raw).not.toMatch(/Paciente Ficticio|Ficticio Ejemplo|telefono_whatsapp|"nombre"|"dni"|alergias/i);
    expect(out.solicitudes[0]).not.toHaveProperty('detalle_json');
    expect(out.solicitudes[0]).not.toHaveProperty('link_ref');
    expect(out.solicitudes[0].paciente_id).toBeTruthy();
    expect(out.solicitudes[0].turno_id).toBe(turnoId);
  });

  it('Dado solicitarResenaSeguro con error forzado Cuando se invoca Entonces no lanza', () => {
    const turnoId = seedTurno('presente');
    db.exec(`CREATE TRIGGER fallo_resena2 BEFORE INSERT ON solicitud_resena BEGIN SELECT RAISE(ABORT,'fail'); END;`);
    try {
      expect(() => solicitarResenaSeguro(db, cfg().solicitudResena, turnoId)).not.toThrow();
    } finally {
      db.exec('DROP TRIGGER IF EXISTS fallo_resena2;');
    }
  });
});
