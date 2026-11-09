/**
 * C-17 3.1/3.2: acciones portal sobre turnos propios (scoping, transiciones,
 * anticipación, reprogramación con anti-solapamiento/bloqueos, sin cambio parcial).
 * SQLite real (R12). Dado/Cuando/Entonces. Sin PHI.
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { ejecutarAccionPortalTurno } from '../src/portal/portalAccionTurno.service.js';
import { TurnoRepository } from '../src/agenda/turno.repository.js';
import { APP_CONFIG } from './helpers/agenda-fixtures.js';

const AHORA = new Date('2026-11-10T10:00:00.000Z');
const PAC1 = 'pac-act-1';
const PAC2 = 'pac-act-2';
const PROF = 'prof-act-1';
const PROF2 = 'prof-act-2';
const SIL = 'sillon-act-1';
const SIL2 = 'sillon-act-2';

function seed(db: DatabaseSync): void {
  for (const [id, n] of [[PAC1, 'Uno'], [PAC2, 'Dos']] as const) {
    db.prepare(`INSERT INTO paciente (id, nombre, created_at, updated_at) VALUES (?,?,?,?)`).run(id, `Paciente Ficticio ${n}`, AHORA.toISOString(), AHORA.toISOString());
  }
  for (const [id, n] of [[PROF, 'A'], [PROF2, 'B']] as const) db.prepare(`INSERT INTO profesional (id, nombre, activo, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`).run(id, `Prof Ficticio ${n}`, AHORA.toISOString(), AHORA.toISOString());
  for (const [id, n] of [[SIL, 'A'], [SIL2, 'B']] as const) db.prepare(`INSERT INTO sillon (id, nombre, activo, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`).run(id, `Sillon Ficticio ${n}`, AHORA.toISOString(), AHORA.toISOString());
}

function crearTurno(db: DatabaseSync, args: { id: string; paciente: string; prof?: string; sillon?: string; inicio: string; fin: string; estado?: string }): void {
  db.prepare(`INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(args.id, args.prof ?? PROF, args.sillon ?? SIL, args.paciente, args.inicio, args.fin, args.estado ?? 'reservado', 'recepcion', AHORA.toISOString(), AHORA.toISOString());
}

let db: DatabaseSync;
beforeEach(() => { db = openDatabase(':memory:'); seed(db); });
afterEach(() => { db.close(); });

describe('Portal acciones turno (C-17, 3.1/3.2)', () => {
  it('Dado turno propio reservado Cuando confirma Entonces transición válida y estado confirmado', () => {
    crearTurno(db, { id: 't1', paciente: PAC1, inicio: '2026-11-15T10:00:00.000Z', fin: '2026-11-15T10:30:00.000Z' });
    const r = ejecutarAccionPortalTurno(db, { pacienteId: PAC1, turnoId: 't1', accion: 'confirmar' }, APP_CONFIG, AHORA);
    expect(r.estado).toBe('confirmado');
    expect(new TurnoRepository(db).findById('t1')?.estado).toBe('confirmado');
  });

  it('Dado turno propio sin anticipación suficiente Cuando cancela Entonces rechaza sin cambiar estado', () => {
    crearTurno(db, { id: 't2', paciente: PAC1, inicio: '2026-11-10T10:30:00.000Z', fin: '2026-11-10T11:00:00.000Z' }); // 30 min
    try {
      ejecutarAccionPortalTurno(db, { pacienteId: PAC1, turnoId: 't2', accion: 'cancelar' }, APP_CONFIG, AHORA);
      expect.fail();
    } catch (e) {
      expect((e as { code?: string }).code).toBe('validacion');
    }
    expect(new TurnoRepository(db).findById('t2')?.estado).toBe('reservado');
  });

  it('Dado token de un paciente Cuando actúa sobre turno ajeno Entonces rechaza sin filtrar PHI/existencia', () => {
    crearTurno(db, { id: 't3', paciente: PAC2, inicio: '2026-11-15T10:00:00.000Z', fin: '2026-11-15T10:30:00.000Z' });
    try {
      ejecutarAccionPortalTurno(db, { pacienteId: PAC1, turnoId: 't3', accion: 'confirmar' }, APP_CONFIG, AHORA);
      expect.fail();
    } catch (e) {
      expect((e as { status?: number; code?: string }).code).toBe('not_found');
      expect(JSON.stringify(e)).not.toMatch(/Paciente Ficticio Dos|pac-act-2/);
    }
    expect(new TurnoRepository(db).findById('t3')?.estado).toBe('reservado');
  });

  it('Dado reprogramación con conflicto Cuando confirma Entonces no persiste cambio parcial', () => {
    crearTurno(db, { id: 't4', paciente: PAC1, inicio: '2026-11-15T10:00:00.000Z', fin: '2026-11-15T10:30:00.000Z' });
    crearTurno(db, { id: 't5', paciente: PAC2, prof: PROF2, sillon: SIL, inicio: '2026-11-16T10:00:00.000Z', fin: '2026-11-16T10:30:00.000Z' }); // solape sillón
    try {
      ejecutarAccionPortalTurno(db, { pacienteId: PAC1, turnoId: 't4', accion: 'reprogramar', nuevoInicio: '2026-11-16T10:00:00.000Z', nuevoFin: '2026-11-16T10:30:00.000Z' }, APP_CONFIG, AHORA);
      expect.fail();
    } catch (e) {
      expect((e as { code?: string }).code).toBe('conflicto');
    }
    expect(new TurnoRepository(db).findById('t4')?.estado).toBe('reservado');
    expect(new TurnoRepository(db).countAll()).toBe(2);
  });

  it('Dado reprogramación válida Cuando confirma Entonces cancela original y crea nuevo reservado del mismo paciente', () => {
    crearTurno(db, { id: 't6', paciente: PAC1, inicio: '2026-11-15T10:00:00.000Z', fin: '2026-11-15T10:30:00.000Z' });
    const r = ejecutarAccionPortalTurno(db, { pacienteId: PAC1, turnoId: 't6', accion: 'reprogramar', nuevoInicio: '2026-11-17T10:00:00.000Z', nuevoFin: '2026-11-17T10:30:00.000Z' }, APP_CONFIG, AHORA);
    expect(new TurnoRepository(db).findById('t6')?.estado).toBe('cancelado');
    expect(r.turnoReprogramado).toBeDefined();
    const nuevo = new TurnoRepository(db).findById(r.turnoReprogramado!);
    expect(nuevo?.estado).toBe('reservado');
    expect(nuevo?.paciente_id).toBe(PAC1);
  });
});
