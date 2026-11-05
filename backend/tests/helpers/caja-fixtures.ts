/**
 * Helpers de seed para los tests de caja (C-11).
 * SQLite REAL en memoria con migraciones 001→011 aplicadas (R12: sin mock de
 * base ni de transacciones) y datos estrictamente ficticios (R1/R12).
 * Los ids son literales legibles para las aserciones (no hay PHI).
 */
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/shared/repository.js';
import { fechaContable } from '../../src/shared/fechas.js';
import { CajaService } from '../../src/caja/caja.service.js';
import type { MercadoPagoProveedor } from '../../src/caja/mercadopago/index.js';

export const ZONA_TEST = 'America/Buenos_Aires';

/** Fecha contable de "hoy" para la zona de test (la misma fórmula del servicio). */
export function diaContableHoy(zona: string = ZONA_TEST): string {
  return fechaContable(new Date().toISOString(), zona);
}

/** Semilla mínima: profesionales/sillón/prestación/usuario/paciente/turno sin conceptos. */
export interface CajaSeedBase {
  readonly usuarioId: string;
  readonly profesionalId: string;
  readonly sillonId: string;
  readonly prestacionId: string;
  readonly pacienteId: string;
  readonly turnoLimpioId: string;
}

export function seedCajaBase(db: DatabaseSync): CajaSeedBase {
  const ahora = new Date().toISOString();
  db.prepare(
    `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at)
     VALUES ('prof-caja', 'Profesional Ficticio', 'MN-1001', 'Odontología', 1, ?, ?)`,
  ).run(ahora, ahora);
  db.prepare(
    `INSERT INTO sillon (id, nombre, activo, created_at, updated_at)
     VALUES ('sillon-caja', 'Sillón Ficticio', 1, ?, ?)`,
  ).run(ahora, ahora);
  db.prepare(
    `INSERT INTO prestacion (id, codigo, nombre, duracion_min, created_at, updated_at)
     VALUES ('pres-caja', 'CONS-C11', 'Consulta Ficticia', 30, ?, ?)`,
  ).run(ahora, ahora);
  db.prepare(
    `INSERT INTO usuario (id, email, password_hash, activo, profesional_id, created_at, updated_at)
     VALUES ('user-caja', 'caja@ficticio.test', 'hash', 1, NULL, ?, ?)`,
  ).run(ahora, ahora);
  db.prepare(
    `INSERT INTO paciente (id, nombre, telefono_whatsapp, obra_social_plan_id, activo, created_at, updated_at)
     VALUES ('pac-caja', 'Paciente Ficticio', NULL, NULL, 1, ?, ?)`,
  ).run(ahora, ahora);
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at)
     VALUES ('turno-caja', 'prof-caja', 'sillon-caja', 'pac-caja', 'pres-caja',
             '2026-11-01T10:00:00.000Z', '2026-11-01T10:30:00.000Z', 'confirmado', 'recepcion', ?, ?)`,
  ).run(ahora, ahora);
  return {
    usuarioId: 'user-caja',
    profesionalId: 'prof-caja',
    sillonId: 'sillon-caja',
    prestacionId: 'pres-caja',
    pacienteId: 'pac-caja',
    turnoLimpioId: 'turno-caja',
  };
}

/** Inserta un concepto (presupuesto) ficticio; default estado `aceptado`. */
export interface ConceptoSeed {
  readonly id: string;
  readonly turnoId?: string | null;
  readonly pacienteId?: string;
  readonly estado?: string;
  readonly totalCentavos: number;
  readonly coberturaCentavos: number;
  readonly saldoCentavos: number;
}

export function insertConcepto(db: DatabaseSync, args: ConceptoSeed): void {
  const ahora = new Date().toISOString();
  db.prepare(
    `INSERT INTO presupuesto
       (id, paciente_id, turno_id, estado, total_centavos, cobertura_centavos,
        saldo_centavos, obra_social_plan_id, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
  ).run(
    args.id,
    args.pacienteId ?? 'pac-caja',
    args.turnoId ?? null,
    args.estado ?? 'aceptado',
    args.totalCentavos,
    args.coberturaCentavos,
    args.saldoCentavos,
    ahora,
    ahora,
  );
}

/** Construye el servicio con zona de test y opciones MP opcionales. */
export function servicioCaja(
  db: DatabaseSync,
  opciones?: {
    zonaHoraria?: string;
    mp?: { proveedor: MercadoPagoProveedor; webhookSecret: string };
  },
): CajaService {
  return new CajaService(db, {
    zonaHoraria: opciones?.zonaHoraria ?? ZONA_TEST,
    mercadopago: opciones?.mp,
  });
}

/** Usuario adicional con id específico (para actores diferenciados). */
export function insertUsuario(db: DatabaseSync, id: string, email: string): void {
  const ahora = new Date().toISOString();
  db.prepare(
    `INSERT INTO usuario (id, email, password_hash, activo, profesional_id, created_at, updated_at)
     VALUES (?, ?, 'hash', 1, NULL, ?, ?)`,
  ).run(id, email, ahora, ahora);
}

/** Consulta rápida de movimientos de un pago (para asserts de trazabilidad). */
export function movimientosDePago(
  db: DatabaseSync,
  pagoId: string,
): { tipo: string; monto_centavos: number; aplicado_en: string; motivo_asignacion: string | null }[] {
  return db
    .prepare(
      `SELECT tipo, monto_centavos, aplicado_en, motivo_asignacion
         FROM movimiento_caja WHERE pago_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .all(pagoId) as unknown as {
    tipo: string;
    monto_centavos: number;
    aplicado_en: string;
    motivo_asignacion: string | null;
  }[];
}
