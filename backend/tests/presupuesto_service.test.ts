/**
 * Task 4.x: PresupuestoService - Dado/Cuando/Entonces.
 * SQLite REAL en memoria (R12). Datos ficticios (R1/R12).
 * No floats en montos (R2/R5).
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { PresupuestoService } from '../src/clinica/presupuestos.service.js';
import type { PresupuestoEstado } from '../src/shared/types.js';

let db: DatabaseSync;
let svc: PresupuestoService;

function seedBase(db: DatabaseSync): void {
  const now = '2026-11-01T10:00:00.000Z';
  db.prepare(
    `INSERT INTO usuario (id, email, password_hash, activo, created_at, updated_at) VALUES ('user-1', 'usuario@ficticio.test', 'hash', 1, ?, ?)`,
  ).run(now, now);
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
    `INSERT INTO paciente (id, nombre, obra_social_plan_id, activo, created_at, updated_at) VALUES ('pac-2', 'Paciente Ficticio Dos', 'plan-1', 1, ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO obra_social_plan (id, obra_social, plan, cobertura_pct, activo, created_at, updated_at) VALUES ('plan-1', 'OS Ficticia', 'Plan Ficticio', 60, 1, ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at) VALUES ('turno-1', 'prof-1', 'sillon-1', 'pac-1', '2026-11-01T10:00:00.000Z', '2026-11-01T10:30:00.000Z', 'reservado', 'recepcion', ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO odontograma_evento (id, paciente_id, turno_id, pieza_fdi, superficie, hallazgo, ocurrido_en, actor_usuario_id, profesional_id, created_at) VALUES ('odo-1', 'pac-1', 'turno-1', 16, 'O', 'caries', '2026-11-01T09:00:00.000Z', 'user-1', 'prof-1', ?)`,
  ).run(now);
}

beforeEach(() => {
  db = openDatabase(':memory:');
  seedBase(db);
  svc = new PresupuestoService(db);
});

afterEach(() => {
  db.close();
});

// ── 4.1 Creación (turno_id NULLABLE, estado borrador) ──
describe('4.1 Creación de presupuesto', () => {
  it('Dado paciente sin turno Cuando crear presupuesto standalone Entonces estado borrador y turno_id NULL', () => {
    const presupuesto = svc.crearPresupuesto({
      pacienteId: 'pac-1' as any,
      turnoId: null,
    });
    expect(presupuesto.estado).toBe('borrador');
    expect(presupuesto.turno_id).toBeNull();
    expect(presupuesto.total_centavos).toBe(0);
    expect(presupuesto.cobertura_centavos).toBe(0);
    expect(presupuesto.saldo_centavos).toBe(0);
  });

  it('Dado paciente con turno válido Cuando crear presupuesto Entonces conserva turno_id', () => {
    const presupuesto = svc.crearPresupuesto({
      pacienteId: 'pac-1' as any,
      turnoId: 'turno-1' as any,
    });
    expect(presupuesto.estado).toBe('borrador');
    expect(presupuesto.turno_id).toBe('turno-1');
  });

  it('Dado turno de otro paciente Cuando crear Entonces lanza error 400', () => {
    // Crear un turno para otro paciente
    db.prepare(
      `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at) VALUES ('turno-otro', 'prof-1', 'sillon-1', 'pac-2', '2026-11-01T11:00:00.000Z', '2026-11-01T11:30:00.000Z', 'reservado', 'recepcion', '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z')`,
    ).run();
    let error: any;
    try {
      svc.crearPresupuesto({
        pacienteId: 'pac-1' as any,
        turnoId: 'turno-otro' as any,
      });
    } catch (err) {
      error = err;
    }
    expect(error.status).toBe(400);
  });
});

// ── 4.2 Autocalculo cobertura/saldo ──
describe('4.2 Autocalculo cobertura y saldo', () => {
  it('Dado paciente con plan cobertura_pct 60 Cuando crear presupuesto de 50000 Entonces cobertura 30000 saldo 20000', () => {
    const presupuesto = svc.crearPresupuesto({
      pacienteId: 'pac-2' as any,
      turnoId: null,
      total_centavos: 50000,
    });
    expect(presupuesto.cobertura_centavos).toBe(30000);
    expect(presupuesto.saldo_centavos).toBe(20000);
  });

  it('Dado paciente sin plan Cuando crear presupuesto de 50000 Entonces cobertura 0 saldo 50000', () => {
    const presupuesto = svc.crearPresupuesto({
      pacienteId: 'pac-1' as any,
      turnoId: null,
      total_centavos: 50000,
    });
    expect(presupuesto.cobertura_centavos).toBe(0);
    expect(presupuesto.saldo_centavos).toBe(50000);
  });

  it('Dado borrador de 50000 Cuando cambiar paciente a plan 60% Entonces cobertura 30000 saldo 20000', () => {
    const presupuesto = svc.crearPresupuesto({
      pacienteId: 'pac-1' as any,
      turnoId: null,
      total_centavos: 50000,
    });
    const actualizado = svc.cambiarPaciente(presupuesto.id as any, 'pac-2' as any);
    expect(actualizado.cobertura_centavos).toBe(30000);
    expect(actualizado.saldo_centavos).toBe(20000);
  });
});

// ── 4.3 Máquina de estados ──
describe('4.3 Máquina de estados', () => {
  it('Dado borrador Cuando transicionar a enviado Entonces estado enviado', () => {
    const presupuesto = svc.crearPresupuesto({
      pacienteId: 'pac-1' as any,
      turnoId: null,
    });
    const resultado = svc.transicionarEstado(presupuesto.id as any, 'enviado' as PresupuestoEstado);
    expect(resultado.estado).toBe('enviado');
  });

  it('Dado enviado Cuando transicionar a aceptado Entonces estado aceptado (terminal)', () => {
    const presupuesto = svc.crearPresupuesto({
      pacienteId: 'pac-1' as any,
      turnoId: null,
    });
    svc.transicionarEstado(presupuesto.id as any, 'enviado' as PresupuestoEstado);
    const resultado = svc.transicionarEstado(presupuesto.id as any, 'aceptado' as PresupuestoEstado);
    expect(resultado.estado).toBe('aceptado');
  });

  it('Dado enviado Cuando transicionar a rechazado Entonces estado rechazado (terminal)', () => {
    const presupuesto = svc.crearPresupuesto({
      pacienteId: 'pac-1' as any,
      turnoId: null,
    });
    svc.transicionarEstado(presupuesto.id as any, 'enviado' as PresupuestoEstado);
    const resultado = svc.transicionarEstado(presupuesto.id as any, 'rechazado' as PresupuestoEstado);
    expect(resultado.estado).toBe('rechazado');
  });

  it('Dado enviado Cuando transicionar a vencido Entonces estado vencido (terminal)', () => {
    const presupuesto = svc.crearPresupuesto({
      pacienteId: 'pac-1' as any,
      turnoId: null,
    });
    svc.transicionarEstado(presupuesto.id as any, 'enviado' as PresupuestoEstado);
    const resultado = svc.transicionarEstado(presupuesto.id as any, 'vencido' as PresupuestoEstado);
    expect(resultado.estado).toBe('vencido');
  });

  it('Dado borrador Cuando transicionar directamente a aceptado Entonces 400 y permanece borrador', () => {
    const presupuesto = svc.crearPresupuesto({
      pacienteId: 'pac-1' as any,
      turnoId: null,
    });
    let error: any;
    try {
      svc.transicionarEstado(presupuesto.id as any, 'aceptado' as PresupuestoEstado);
    } catch (err) {
      error = err;
    }
    expect(error.status).toBe(400);
    const actual = svc.obtenerPresupuesto(presupuesto.id as any);
    expect(actual.estado).toBe('borrador');
  });

  it('Dado aceptado (terminal) Cuando transicionar a enviado Entonces 400 y permanece aceptado', () => {
    const presupuesto = svc.crearPresupuesto({
      pacienteId: 'pac-1' as any,
      turnoId: null,
    });
    svc.transicionarEstado(presupuesto.id as any, 'enviado' as PresupuestoEstado);
    svc.transicionarEstado(presupuesto.id as any, 'aceptado' as PresupuestoEstado);
    let error: any;
    try {
      svc.transicionarEstado(presupuesto.id as any, 'enviado' as PresupuestoEstado);
    } catch (err) {
      error = err;
    }
    expect(error.status).toBe(400);
    const actual = svc.obtenerPresupuesto(presupuesto.id as any);
    expect(actual.estado).toBe('aceptado');
  });

  it('Dado presupuesto inexistente Cuando transicionar Entonces 404', () => {
    let error: any;
    try {
      svc.transicionarEstado('presup-inexistente' as any, 'enviado' as PresupuestoEstado);
    } catch (err) {
      error = err;
    }
    expect(error.status).toBe(404);
  });
});

// ── 4.4 Edición solo en borrador ──
describe('4.4 Edición solo en borrador', () => {
  it('Dado borrador Cuando editar total Entonces se aplica el cambio', () => {
    const presupuesto = svc.crearPresupuesto({
      pacienteId: 'pac-1' as any,
      turnoId: null,
      total_centavos: 10000,
    });
    const actualizado = svc.editarPresupuesto(presupuesto.id as any, {
      total_centavos: 20000,
    });
    expect(actualizado.total_centavos).toBe(20000);
  });

  it('Dado enviado Cuando editar Entonces 400 y no aplica cambios', () => {
    const presupuesto = svc.crearPresupuesto({
      pacienteId: 'pac-1' as any,
      turnoId: null,
    });
    svc.transicionarEstado(presupuesto.id as any, 'enviado' as PresupuestoEstado);
    let error: any;
    try {
      svc.editarPresupuesto(presupuesto.id as any, { total_centavos: 99999 });
    } catch (err) {
      error = err;
    }
    expect(error.status).toBe(400);
    const actual = svc.obtenerPresupuesto(presupuesto.id as any);
    expect(actual.total_centavos).toBe(0);
  });
});

// ── 4.5 Ítems ──
describe('4.5 Ítems de presupuesto', () => {
  it('Dado ítem de 30000 y otro de 20000 Cuando agregar ambos Entonces total 50000', () => {
    const presupuesto = svc.crearPresupuesto({
      pacienteId: 'pac-1' as any,
      turnoId: null,
    });
    svc.agregarItem(presupuesto.id as any, {
      descripcion: 'Item A ficticio',
      monto_centavos: 30000,
      pieza_fdi: null,
      superficie: null,
    });
    svc.agregarItem(presupuesto.id as any, {
      descripcion: 'Item B ficticio',
      monto_centavos: 20000,
      pieza_fdi: null,
      superficie: null,
    });
    const actual = svc.obtenerPresupuesto(presupuesto.id as any);
    expect(actual.total_centavos).toBe(50000);
    expect(actual.items).toHaveLength(2);
  });

  it('Dado ítem de 30000 Cuando editar a 40000 Entonces total pasa de 30000 a 40000', () => {
    const presupuesto = svc.crearPresupuesto({
      pacienteId: 'pac-1' as any,
      turnoId: null,
    });
    const item = svc.agregarItem(presupuesto.id as any, {
      descripcion: 'Item ficticio',
      monto_centavos: 30000,
      pieza_fdi: null,
      superficie: null,
    });
    svc.editarItem(item.id as any, { monto_centavos: 40000 });
    const actual = svc.obtenerPresupuesto(presupuesto.id as any);
    expect(actual.total_centavos).toBe(40000);
  });

  it('Dado monto negativo Cuando agregar ítem Entonces 400 y no persiste', () => {
    const presupuesto = svc.crearPresupuesto({
      pacienteId: 'pac-1' as any,
      turnoId: null,
    });
    let error: any;
    try {
      svc.agregarItem(presupuesto.id as any, {
        descripcion: 'Item ficticio',
        monto_centavos: -100,
        pieza_fdi: null,
        superficie: null,
      });
    } catch (err) {
      error = err;
    }
    expect(error.status).toBe(400);
    const actual = svc.obtenerPresupuesto(presupuesto.id as any);
    expect(actual.total_centavos).toBe(0);
  });

  it('Dado pieza_fdi 16 superficie O que coincide con odontograma Cuando agregar ítem Entonces 201', () => {
    const presupuesto = svc.crearPresupuesto({
      pacienteId: 'pac-1' as any,
      turnoId: null,
    });
    const item = svc.agregarItem(presupuesto.id as any, {
      descripcion: 'Obturación ficticia',
      monto_centavos: 25000,
      pieza_fdi: 16,
      superficie: 'O',
    });
    expect(item.pieza_fdi).toBe(16);
    expect(item.superficie).toBe('O');
  });

  it('Dado pieza_fdi 99 (fuera de catálogo) Cuando agregar ítem Entonces 400', () => {
    const presupuesto = svc.crearPresupuesto({
      pacienteId: 'pac-1' as any,
      turnoId: null,
    });
    let error: any;
    try {
      svc.agregarItem(presupuesto.id as any, {
        descripcion: 'Item ficticio',
        monto_centavos: 10000,
        pieza_fdi: 99,
        superficie: 'O',
      });
    } catch (err) {
      error = err;
    }
    expect(error.status).toBe(400);
  });
});
