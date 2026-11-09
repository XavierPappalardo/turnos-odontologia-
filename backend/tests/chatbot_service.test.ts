/**
 * C-16: orquestación chatbot (intenciones, confirmación, agenda con overlaps, transiciones).
 * SQLite real (R12). Dado/Cuando/Entonces. Datos ficticios (R1).
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import type { AppConfig } from '../src/shared/config.js';
import { procesarMensajeChatbot } from '../src/notificaciones/chatbot/chatbot.service.js';
import { TurnoRepository } from '../src/agenda/turno.repository.js';

const AUTH: AppConfig = {
  port: 0,
  databasePath: ':memory:',
  nodeEnv: 'test',
  jwtSecret: 'test-secret-con-mas-de-32-caracteres-c16',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 604_800,
  loginRateLimitMax: 50,
  loginRateLimitWindowSeconds: 60,
  cookieSecure: false,
  reservaOnline: {
    anticipacionMinSegundos: 7200,
    rateMax: 1000,
    rateWindowSeconds: 60,
    turnoTokenTtlSeconds: 7 * 24 * 60 * 60,
  },
  recordatorio: { t48hHoras: 48, t24hHoras: 24, canalPredeterminado: 'whatsapp' },
  caja: { zonaHoraria: 'America/Buenos_Aires' },
  mercadopago: { habilitado: false, ambiente: 'sandbox', token: null, webhookSecret: null },
  chatbot: { simuladoHabilitado: true, sessionTtlSeconds: 1800, maxIntentosInvalidos: 5, rateMax: 1000, rateWindowSeconds: 60 },
  portalPaciente: { tokenTtlSeconds: 604800, rateMax: 1000, rateWindowSeconds: 60 },
  recuperacionCobranza: {
    habilitado: true,
    inactividadDias: 180,
    recuperacionVentanaHoras: 720,
    cobranzaVentanaHoras: 168,
    maxContactosPorEjecucion: 200,
  },
  solicitudResena: {
    habilitado: true,
    linkResena: 'https://ejemplo.local/resena-placeholder',
    canalPredeterminado: 'whatsapp',
    demoraMinutos: 0,
    ventanaDedupeHoras: 8760,
    maxSolicitudesPorLote: 200,
  },
};

const PROF = 'prof-c16-1';
const PROF2 = 'prof-c16-2';
const SILLA = 'sillon-c16-1';
const SILLA2 = 'sillon-c16-2';
const PAC = 'pac-c16-1';

function seed(db: DatabaseSync): void {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO profesional (id, nombre, activo, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`).run(PROF, 'Prof Ficticio Uno', now, now);
  db.prepare(`INSERT INTO profesional (id, nombre, activo, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`).run(PROF2, 'Prof Ficticia Dos', now, now);
  db.prepare(`INSERT INTO sillon (id, nombre, activo, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`).run(SILLA, 'Sillon Ficticio 1', now, now);
  db.prepare(`INSERT INTO sillon (id, nombre, activo, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`).run(SILLA2, 'Sillon Ficticio 2', now, now);
  db.prepare(`INSERT INTO paciente (id, nombre, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(PAC, 'Paciente Ficticio Uno', now, now);
}

function crearTurno(db: DatabaseSync, args: { id?: string; prof?: string; sillon?: string; inicio: string; fin: string; estado?: string }): string {
  const id = args.id ?? `turno-c16-${Math.random().toString(36).slice(2)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'recepcion', ?, ?)`,
  ).run(id, args.prof ?? PROF, args.sillon ?? SILLA, PAC, args.inicio, args.fin, args.estado ?? 'reservado', now, now);
  return id;
}

function bloqueo(db: DatabaseSync, args: { prof?: string | null; sillon?: string | null; inicio: string; fin: string }): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO bloqueo (id, profesional_id, sillon_id, inicio, fin, motivo, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'motivo ficticio', ?, ?)`,
  ).run(`bloq-c16-${Math.random().toString(36).slice(2)}`, args.prof ?? null, args.sillon ?? null, args.inicio, args.fin, now, now);
}

let db: DatabaseSync;
beforeEach(() => { db = openDatabase(':memory:'); seed(db); });
afterEach(() => { db.close(); });

describe('Chatbot orquestación determinista (C-16, 3.2)', () => {
  it('Dado intención agendar sin slots Cuando inicia Entonces guía recolección sin mutar', () => {
    const r = procesarMensajeChatbot(db, { conversationId: 'conv-svc-1', text: 'quiero agendar', confirmar: false }, AUTH, '2026-11-10T10:00:00.000Z');
    expect(r.code).toBe('faltan_datos');
    expect(r.intent).toBe('agendar');
    expect(r.text).toMatch(/faltan/i);
    expect(new TurnoRepository(db).countAll()).toBe(0);
  });

  it('Dado slots completos sin confirmar Cuando pide agendar Entonces requiere confirmación explícita', () => {
    const inicio = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
    const fin = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString();
    procesarMensajeChatbot(db, { conversationId: 'conv-svc-2', text: 'agendar', confirmar: false }, AUTH);
    const r = procesarMensajeChatbot(db, {
      conversationId: 'conv-svc-2', text: 'datos', confirmar: false,
      pacienteId: PAC, profesionalId: PROF, sillonId: SILLA, inicio, fin,
    }, AUTH);
    expect(r.code).toBe('requiere_confirmacion');
    expect(new TurnoRepository(db).countAll()).toBe(0);
  });

  it('Dado texto ambiguo Cuando procesa Entonces devuelve ayuda segura sin PHI', () => {
    const r = procesarMensajeChatbot(db, { conversationId: 'conv-svc-3', text: 'asdfgh ???', confirmar: false }, AUTH);
    expect(r.code).toBe('ayuda');
    expect(JSON.stringify(r)).not.toMatch(/DNI|Paciente Ficticio|telefono/i);
  });
});

describe('Chatbot agendar con reglas de agenda (C-16, 4.1)', () => {
  it('Dado slot disponible Cuando confirma agendar Entonces crea turno reservado con id opaco', () => {
    const inicio = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    const fin = new Date(Date.now() + 6.5 * 60 * 60 * 1000).toISOString();
    procesarMensajeChatbot(db, { conversationId: 'conv-ag-1', text: 'agendar', confirmar: false }, AUTH);
    const r = procesarMensajeChatbot(db, {
      conversationId: 'conv-ag-1', text: 'ok', confirmar: true,
      pacienteId: PAC, profesionalId: PROF, sillonId: SILLA, inicio, fin,
    }, AUTH);
    expect(r.code).toBe('agendado');
    expect(r.estado).toBe('reservado');
    expect(r.turnoId).toBeDefined();
    const turno = new TurnoRepository(db).findById(r.turnoId!);
    expect(turno?.estado).toBe('reservado');
  });

  it('Dado solape por profesional Cuando confirma agendar Entonces rechaza sin crear turno', () => {
    const inicio = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString();
    const fin = new Date(Date.now() + 7.5 * 60 * 60 * 1000).toISOString();
    crearTurno(db, { prof: PROF, sillon: SILLA2, inicio, fin });
    procesarMensajeChatbot(db, { conversationId: 'conv-ag-2', text: 'agendar', confirmar: false }, AUTH);
    const r = procesarMensajeChatbot(db, {
      conversationId: 'conv-ag-2', text: 'ok', confirmar: true,
      pacienteId: PAC, profesionalId: PROF, sillonId: SILLA, inicio, fin,
    }, AUTH);
    expect(r.code).toBe('conflicto');
    expect(r.estado).toBe('profesional');
    expect(new TurnoRepository(db).countAll()).toBe(1);
  });

  it('Dado solape por sillón Cuando confirma agendar Entonces rechaza sin crear turno', () => {
    const inicio = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    const fin = new Date(Date.now() + 8.5 * 60 * 60 * 1000).toISOString();
    crearTurno(db, { prof: PROF2, sillon: SILLA, inicio, fin });
    procesarMensajeChatbot(db, { conversationId: 'conv-ag-3', text: 'agendar', confirmar: false }, AUTH);
    const r = procesarMensajeChatbot(db, {
      conversationId: 'conv-ag-3', text: 'ok', confirmar: true,
      pacienteId: PAC, profesionalId: PROF, sillonId: SILLA, inicio, fin,
    }, AUTH);
    expect(r.code).toBe('conflicto');
    expect(r.estado).toBe('sillon');
  });

  it('Dado bloqueo aplicable Cuando confirma agendar Entonces rechaza sin crear turno', () => {
    const inicio = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString();
    const fin = new Date(Date.now() + 9.5 * 60 * 60 * 1000).toISOString();
    bloqueo(db, { prof: PROF, inicio, fin });
    procesarMensajeChatbot(db, { conversationId: 'conv-ag-4', text: 'agendar', confirmar: false }, AUTH);
    const r = procesarMensajeChatbot(db, {
      conversationId: 'conv-ag-4', text: 'ok', confirmar: true,
      pacienteId: PAC, profesionalId: PROF, sillonId: SILLA, inicio, fin,
    }, AUTH);
    expect(r.code).toBe('conflicto');
    expect(r.estado).toBe('bloqueo');
  });

  it('Dado anticipación insuficiente Cuando confirma agendar Entonces rechaza con validación', () => {
    const inicio = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min < 2h
    const fin = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    procesarMensajeChatbot(db, { conversationId: 'conv-ag-5', text: 'agendar', confirmar: false }, AUTH);
    const r = procesarMensajeChatbot(db, {
      conversationId: 'conv-ag-5', text: 'ok', confirmar: true,
      pacienteId: PAC, profesionalId: PROF, sillonId: SILLA, inicio, fin,
    }, AUTH);
    expect(r.code).toBe('validacion');
  });
});

describe('Chatbot confirmar/cancelar/reprogramar (C-16, 4.2)', () => {
  it('Dado turno reservado Cuando confirma por conversación Entonces pasa a confirmado', () => {
    const inicio = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString();
    const fin = new Date(Date.now() + 10.5 * 60 * 60 * 1000).toISOString();
    const turnoId = crearTurno(db, { inicio, fin, estado: 'reservado' });
    procesarMensajeChatbot(db, { conversationId: 'conv-t-1', text: 'confirmar', confirmar: false, turnoId }, AUTH);
    const r = procesarMensajeChatbot(db, { conversationId: 'conv-t-1', text: 'si', confirmar: true, turnoId }, AUTH);
    expect(r.code).toBe('confirmado');
    expect(new TurnoRepository(db).findById(turnoId)?.estado).toBe('confirmado');
  });

  it('Dado transición inválida Cuando confirma turno ya confirmado Entonces rechaza sin cambiar estado', () => {
    const inicio = new Date(Date.now() + 11 * 60 * 60 * 1000).toISOString();
    const fin = new Date(Date.now() + 11.5 * 60 * 60 * 1000).toISOString();
    const turnoId = crearTurno(db, { inicio, fin, estado: 'confirmado' });
    procesarMensajeChatbot(db, { conversationId: 'conv-t-2', text: 'confirmar', confirmar: false, turnoId }, AUTH);
    const r = procesarMensajeChatbot(db, { conversationId: 'conv-t-2', text: 'si', confirmar: true, turnoId }, AUTH);
    expect(r.code).toBe('transicion_invalida');
    expect(new TurnoRepository(db).findById(turnoId)?.estado).toBe('confirmado');
  });

  it('Dado cancelación sin anticipación suficiente Cuando cancela Entonces rechaza', () => {
    const inicio = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const fin = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const turnoId = crearTurno(db, { inicio, fin, estado: 'reservado' });
    procesarMensajeChatbot(db, { conversationId: 'conv-t-3', text: 'cancelar', confirmar: false, turnoId }, AUTH);
    const r = procesarMensajeChatbot(db, { conversationId: 'conv-t-3', text: 'si', confirmar: true, turnoId }, AUTH);
    expect(r.code).toBe('validacion');
    expect(new TurnoRepository(db).findById(turnoId)?.estado).toBe('reservado');
  });

  it('Dado reprogramación con conflicto en nuevo horario Cuando confirma Entonces no persiste cambio parcial', () => {
    const inicio = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const fin = new Date(Date.now() + 12.5 * 60 * 60 * 1000).toISOString();
    const turnoId = crearTurno(db, { inicio, fin, estado: 'reservado' });
    const nInicio = new Date(Date.now() + 13 * 60 * 60 * 1000).toISOString();
    const nFin = new Date(Date.now() + 13.5 * 60 * 60 * 1000).toISOString();
    crearTurno(db, { prof: PROF2, sillon: SILLA, inicio: nInicio, fin: nFin }); // solape por sillón
    procesarMensajeChatbot(db, { conversationId: 'conv-t-4', text: 'reprogramar', confirmar: false, turnoId, inicio: nInicio, fin: nFin }, AUTH);
    const r = procesarMensajeChatbot(db, { conversationId: 'conv-t-4', text: 'si', confirmar: true, turnoId, inicio: nInicio, fin: nFin }, AUTH);
    expect(r.code).toBe('conflicto');
    const original = new TurnoRepository(db).findById(turnoId);
    expect(original?.estado).toBe('reservado');
    expect(new TurnoRepository(db).countAll()).toBe(2); // no se creó turno nuevo
  });

  it('Dado reprogramación válida Cuando confirma Entonces cancela original y crea nuevo reservado', () => {
    const inicio = new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString();
    const fin = new Date(Date.now() + 14.5 * 60 * 60 * 1000).toISOString();
    const turnoId = crearTurno(db, { inicio, fin, estado: 'reservado' });
    const nInicio = new Date(Date.now() + 15 * 60 * 60 * 1000).toISOString();
    const nFin = new Date(Date.now() + 15.5 * 60 * 60 * 1000).toISOString();
    procesarMensajeChatbot(db, { conversationId: 'conv-t-5', text: 'reprogramar', confirmar: false, turnoId, inicio: nInicio, fin: nFin }, AUTH);
    const r = procesarMensajeChatbot(db, { conversationId: 'conv-t-5', text: 'si', confirmar: true, turnoId, inicio: nInicio, fin: nFin }, AUTH);
    expect(r.code).toBe('reprogramado');
    expect(r.turnoId).toBeDefined();
    expect(new TurnoRepository(db).findById(turnoId)?.estado).toBe('cancelado');
    expect(new TurnoRepository(db).findById(r.turnoId!)?.estado).toBe('reservado');
  });
});
