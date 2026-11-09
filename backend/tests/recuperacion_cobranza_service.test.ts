/**
 * C-18 2.1/3.1/4.1: segmentación inactivos, campañas recuperación y cobranza automática.
 * SQLite real (R12). Dado/Cuando/Entonces. Fixtures ficticias, sin PHI.
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { RecuperacionCobranzaService } from '../src/notificaciones/recuperacion-cobranza/service.js';
import { APP_CONFIG } from './helpers/agenda-fixtures.js';
import type { AppConfig } from '../src/shared/config.js';

const AHORA = '2026-11-10T12:00:00.000Z';
const PAC_INACTIVO = 'pac-inac-1';
const PAC_ACTIVO = 'pac-act-1';
const PAC_DEUDA = 'pac-deu-1';
const PAC_SIN_DEUDA = 'pac-nodeu-1';
const PROF = 'prof-rc-1';
const SIL = 'sillon-rc-1';

function seedBase(db: DatabaseSync): void {
  for (const [id, n] of [[PAC_INACTIVO, 'Uno'], [PAC_ACTIVO, 'Dos'], [PAC_DEUDA, 'Tres'], [PAC_SIN_DEUDA, 'Cuatro']] as const) {
    db.prepare(`INSERT INTO paciente (id, nombre, created_at, updated_at) VALUES (?,?,?,?)`).run(id, `Paciente Ficticio ${n}`, AHORA, AHORA);
  }
  db.prepare(`INSERT INTO profesional (id, nombre, activo, created_at, updated_at) VALUES (?, 'Prof Ficticio', 1, ?, ?)`).run(PROF, AHORA, AHORA);
  db.prepare(`INSERT INTO sillon (id, nombre, activo, created_at, updated_at) VALUES (?, 'Sillon Ficticio', 1, ?, ?)`).run(SIL, AHORA, AHORA);
}

function turnoAtendido(db: DatabaseSync, id: string, paciente: string, inicio: string): void {
  const fin = new Date(new Date(inicio).getTime() + 30 * 60_000).toISOString();
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at)
     VALUES (?,?,?,?,?,?,'atendido','recepcion',?,?)`,
  ).run(id, PROF, SIL, paciente, inicio, fin, AHORA, AHORA);
}

function presupuestoAceptado(db: DatabaseSync, id: string, paciente: string, saldoCentavos: number): void {
  db.prepare(
    `INSERT INTO presupuesto (id, paciente_id, estado, total_centavos, cobertura_centavos, saldo_centavos, created_at, updated_at)
     VALUES (?,?, 'aceptado', ?, 0, ?, ?, ?)`,
  ).run(id, paciente, saldoCentavos, saldoCentavos, AHORA, AHORA);
}

let db: DatabaseSync;
beforeEach(() => { db = openDatabase(':memory:'); seedBase(db); });
afterEach(() => { db.close(); });

describe('C-18 segmentación inactivos (2.1)', () => {
  it('Dado paciente sin actividad relevante en ventana Cuando segmenta Entonces lo incluye con IDs opacos', () => {
    turnoAtendido(db, 't-old', PAC_INACTIVO, '2025-01-01T10:00:00.000Z');
    turnoAtendido(db, 't-new', PAC_ACTIVO, '2026-10-20T10:00:00.000Z');
    const svc = new RecuperacionCobranzaService(db, APP_CONFIG);
    const res = svc.segmentarInactivos(AHORA);
    expect(res.habilitado).toBe(true);
    expect(res.pacientes.some((p) => p.paciente_id === PAC_INACTIVO)).toBe(true);
    expect(res.pacientes.some((p) => p.paciente_id === PAC_ACTIVO)).toBe(false);
    expect(JSON.stringify(res)).not.toMatch(/Paciente Ficticio|DNI|telefono/i);
  });

  it('Dado funcionalidad deshabilitada Cuando segmenta Entonces resultado seguro vacío', () => {
    const cfg: AppConfig = { ...APP_CONFIG, recuperacionCobranza: { ...APP_CONFIG.recuperacionCobranza, habilitado: false } };
    const svc = new RecuperacionCobranzaService(db, cfg);
    const res = svc.segmentarInactivos(AHORA);
    expect(res).toMatchObject({ habilitado: false, total: 0, pacientes: [] });
  });

  it('Dado configuración inválida Cuando segmenta Entonces rechaza con error tipado sin PHI', () => {
    const cfg: AppConfig = { ...APP_CONFIG, recuperacionCobranza: { ...APP_CONFIG.recuperacionCobranza, inactividadDias: 0 } };
    const svc = new RecuperacionCobranzaService(db, cfg);
    expect(() => svc.segmentarInactivos(AHORA)).toThrow();
    try { svc.segmentarInactivos(AHORA); } catch (e) {
      expect((e as { code?: string }).code).toBe('validacion');
      expect(JSON.stringify(e)).not.toMatch(/Paciente Ficticio/i);
    }
  });
});

describe('C-18 campañas recuperación (3.1)', () => {
  it('Dado segmento con paciente elegible Cuando ejecuta recuperación Entonces registra envío simulado sin PHI', () => {
    turnoAtendido(db, 't-old2', PAC_INACTIVO, '2025-01-01T10:00:00.000Z');
    const svc = new RecuperacionCobranzaService(db, APP_CONFIG);
    const out = svc.ejecutarRecuperacion(null, AHORA);
    expect(out.enviados).toBeGreaterThan(0);
    const contactos = db.prepare(`SELECT estado, detalle_json FROM recuperacion_contacto WHERE ejecucion_id = ?`).all(out.id) as Array<{ estado: string; detalle_json: string }>;
    expect(contactos.some((c) => c.estado === 'enviado_simulado')).toBe(true);
    expect(JSON.stringify(contactos)).not.toMatch(/Paciente Ficticio|telefono|whatsapp_meta/i);
  });

  it('Dado contacto reciente dentro de ventana Cuando re-ejecuta Entonces omite duplicado y registra motivo', () => {
    turnoAtendido(db, 't-old3', PAC_INACTIVO, '2025-01-01T10:00:00.000Z');
    const svc = new RecuperacionCobranzaService(db, APP_CONFIG);
    svc.ejecutarRecuperacion(null, AHORA);
    const out2 = svc.ejecutarRecuperacion(null, '2026-11-11T12:00:00.000Z'); // dentro de 30 días
    expect(out2.omitidos).toBeGreaterThan(0);
    const omitido = db.prepare(`SELECT motivo_omision FROM recuperacion_contacto WHERE ejecucion_id = ? AND estado='omitido'`).get(out2.id) as { motivo_omision: string } | undefined;
    expect(omitido?.motivo_omision).toBe('ventana_no_cumplida');
  });
});

describe('C-18 cobranza automática (4.1)', () => {
  it('Dado paciente con deuda pendiente > 0 Cuando ejecuta cobranza Entonces genera seguimiento elegible sin mutar caja', () => {
    presupuestoAceptado(db, 'pre-deu', PAC_DEUDA, 12345);
    const pagosAntes = (db.prepare(`SELECT COUNT(*) c FROM pago`).get() as { c: number }).c;
    const movAntes = (db.prepare(`SELECT COUNT(*) c FROM movimiento_caja`).get() as { c: number }).c;
    const svc = new RecuperacionCobranzaService(db, APP_CONFIG);
    const out = svc.ejecutarCobranza(null, AHORA);
    expect(out.enviados).toBeGreaterThan(0);
    const c = db.prepare(`SELECT monto_centavos, estado FROM recuperacion_contacto WHERE ejecucion_id=? AND paciente_id=?`).get(out.id, PAC_DEUDA) as { monto_centavos: number; estado: string };
    expect(c.estado).toBe('enviado_simulado');
    expect(c.monto_centavos).toBe(12345);
    expect(Number.isInteger(c.monto_centavos)).toBe(true);
    expect((db.prepare(`SELECT COUNT(*) c FROM pago`).get() as { c: number }).c).toBe(pagosAntes);
    expect((db.prepare(`SELECT COUNT(*) c FROM movimiento_caja`).get() as { c: number }).c).toBe(movAntes);
  });

  it('Dado paciente sin deuda pendiente Cuando ejecuta cobranza Entonces no genera contacto', () => {
    presupuestoAceptado(db, 'pre-cero', PAC_SIN_DEUDA, 0);
    // saldo 0 => deuda 0; además si hay pagos podría ser 0, pero aquí saldo 0.
    // Para asegurar: saldo 5000 pero pagado completamente sería otro caso; MVP: aceptado con saldo pendiente real vía deudaPorPaciente.
    // Ajuste: deudaPorPaciente usa saldo_centavos - cobradoBolsillo; saldo 0 => 0.
    const svc = new RecuperacionCobranzaService(db, APP_CONFIG);
    const out = svc.ejecutarCobranza(null, AHORA);
    const row = db.prepare(`SELECT * FROM recuperacion_contacto WHERE ejecucion_id=? AND paciente_id=?`).get(out.id, PAC_SIN_DEUDA);
    expect(row).toBeUndefined();
    expect(out.enviados).toBe(0);
  });

  it('Dado cobranza reciente dentro de ventana Cuando re-ejecuta Entonces omite duplicado', () => {
    presupuestoAceptado(db, 'pre-deu2', PAC_DEUDA, 5000);
    // limpiar contacto previo de test anterior? cada test usa nueva DB.
    const svc = new RecuperacionCobranzaService(db, APP_CONFIG);
    svc.ejecutarCobranza(null, AHORA);
    const out2 = svc.ejecutarCobranza(null, '2026-11-12T12:00:00.000Z'); // dentro de 7 días
    const omitido = db.prepare(`SELECT estado, motivo_omision FROM recuperacion_contacto WHERE ejecucion_id=? AND paciente_id=?`).get(out2.id, PAC_DEUDA) as { estado: string; motivo_omision: string } | undefined;
    expect(omitido?.estado).toBe('omitido');
    expect(omitido?.motivo_omision).toBe('ventana_no_cumplida');
  });
});
