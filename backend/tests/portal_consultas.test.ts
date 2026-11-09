/**
 * C-17 2.2: consultas portal acotadas por paciente (turnos/presupuestos, read-only).
 * SQLite real (R12). Dado/Cuando/Entonces. Sin PHI.
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { PortalConsultaRepository } from '../src/portal/portalConsulta.repository.js';

const AHORA = '2026-11-10T10:00:00.000Z';
const PAC1 = 'pac-portal-c1';
const PAC2 = 'pac-portal-c2';

function seed(db: DatabaseSync): void {
  for (const [id, n] of [[PAC1, 'Uno'], [PAC2, 'Dos']] as const) {
    db.prepare(`INSERT INTO paciente (id, nombre, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(id, `Paciente Ficticio ${n}`, AHORA, AHORA);
  }
  db.prepare(`INSERT INTO profesional (id, nombre, activo, created_at, updated_at) VALUES ('prof-pc','Prof Ficticio',1,?,?)`).run(AHORA, AHORA);
  db.prepare(`INSERT INTO sillon (id, nombre, activo, created_at, updated_at) VALUES ('sillon-pc','Sillon Ficticio',1,?,?)`).run(AHORA, AHORA);
  db.prepare(`INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at)
    VALUES ('t-pac1','prof-pc','sillon-pc',?,'2026-11-15T10:00:00.000Z','2026-11-15T10:30:00.000Z','reservado','recepcion',?,?)`).run(PAC1, AHORA, AHORA);
  db.prepare(`INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at)
    VALUES ('t-pac2','prof-pc','sillon-pc',?,'2026-11-16T10:00:00.000Z','2026-11-16T10:30:00.000Z','confirmado','online',?,?)`).run(PAC2, AHORA, AHORA);
  db.prepare(`INSERT INTO presupuesto (id, paciente_id, estado, total_centavos, cobertura_centavos, saldo_centavos, created_at, updated_at)
    VALUES ('pre-pac1', ?, 'borrador', 10000, 0, 10000, ?, ?)`).run(PAC1, AHORA, AHORA);
  db.prepare(`INSERT INTO presupuesto (id, paciente_id, estado, total_centavos, cobertura_centavos, saldo_centavos, created_at, updated_at)
    VALUES ('pre-pac2', ?, 'enviado', 20000, 5000, 15000, ?, ?)`).run(PAC2, AHORA, AHORA);
}

let db: DatabaseSync;
beforeEach(() => { db = openDatabase(':memory:'); seed(db); });
afterEach(() => { db.close(); });

describe('PortalConsultaRepository (C-17, 2.2)', () => {
  it('Dado token/contexto de paciente Cuando lista turnos Entonces solo devuelve turnos de ese paciente', () => {
    const repo = new PortalConsultaRepository(db);
    const turnos = repo.listarTurnos(PAC1);
    expect(turnos).toHaveLength(1);
    expect(turnos[0].id).toBe('t-pac1');
    expect(turnos[0].estado).toBe('reservado');
    expect(JSON.stringify(turnos)).not.toContain(PAC2);
  });

  it('Dado paciente sin turnos Cuando lista turnos Entonces devuelve vacío sin error', () => {
    const repo = new PortalConsultaRepository(db);
    expect(repo.listarTurnos('pac-sin-turnos')).toEqual([]);
  });

  it('Dado token/contexto de paciente Cuando lista presupuestos Entonces solo devuelve presupuestos de ese paciente (read-only DTO)', () => {
    const repo = new PortalConsultaRepository(db);
    const pres = repo.listarPresupuestos(PAC1);
    expect(pres).toHaveLength(1);
    expect(pres[0].id).toBe('pre-pac1');
    expect(pres[0].total_centavos).toBe(10000);
    expect(pres[0].moneda).toBe('ARS');
    expect(JSON.stringify(pres)).not.toContain(PAC2);
  });

  it('Dado paciente sin presupuestos Cuando lista Entonces devuelve vacío', () => {
    const repo = new PortalConsultaRepository(db);
    expect(repo.listarPresupuestos('pac-sin-pres')).toEqual([]);
  });

  it('Dado consultas portal Cuando se inspeccionan DTOs Entonces no exponen nombre de paciente ni PHI clínica', () => {
    const repo = new PortalConsultaRepository(db);
    const all = JSON.stringify({ t: repo.listarTurnos(PAC1), p: repo.listarPresupuestos(PAC1) });
    expect(all).not.toMatch(/Paciente Ficticio|nombre.*Ficticio/i);
    expect(all).not.toMatch(/DNI|telefono|pieza_fdi.*descripcion clinica/i);
  });
});
