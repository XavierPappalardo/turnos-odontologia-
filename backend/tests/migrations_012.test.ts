/**
 * Task 2.2: Migración 012 - comisiones (C-13): 6 tablas, CHECKs de montos
 * (identidad del neto y del saldo), índices únicos parciales (reserva
 * exclusiva D12) y triggers insert-only del evento.
 * SQLite REAL en memoria (R12: sin mock de base ni de transacciones).
 * Datos estrictamente ficticios (R1/R12).
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, runMigrations } from '../src/shared/migrations.js';

const AHORA = new Date().toISOString();

function columnasTabla(db: DatabaseSync, tabla: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[]
  ).map((c) => c.name);
}

function sembrarEntidadesBase(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO sillon (id, nombre, activo, created_at, updated_at) VALUES ('sil-1', 'Sillón Ficticio', 1, ?, ?)`,
  ).run(AHORA, AHORA);
  db.prepare(
    `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at) VALUES ('prof-1', 'Prof Ficticio', 'M-123', 'Odontología', 1, ?, ?)`,
  ).run(AHORA, AHORA);
  db.prepare(
    `INSERT INTO usuario (id, email, password_hash, activo, profesional_id, created_at, updated_at) VALUES ('usr-1', 'admin@example.test', 'hash', 1, null, ?, ?)`,
  ).run(AHORA, AHORA);
  db.prepare(
    `INSERT INTO obra_social_plan (id, obra_social, plan, cobertura_pct, activo, created_at, updated_at) VALUES ('osp-1', 'OS Ficticia', '210', 80, 1, ?, ?)`,
  ).run(AHORA, AHORA);
  db.prepare(
    `INSERT INTO paciente (id, nombre, telefono_whatsapp, obra_social_plan_id, activo, created_at, updated_at) VALUES ('pac-1', 'Paciente Ficticio', '+54 9 11 0000-0000', 'osp-1', 1, ?, ?)`,
  ).run(AHORA, AHORA);
  db.prepare(
    `INSERT INTO prestacion (id, codigo, nombre, duracion_min, created_at, updated_at) VALUES ('pres-1', 'CONS-01', 'Consulta Ficticia', 30, ?, ?)`,
  ).run(AHORA, AHORA);
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at) VALUES ('tur-1', 'prof-1', 'sil-1', 'pac-1', 'pres-1', '2026-11-01T10:00:00.000Z', '2026-11-01T10:30:00.000Z', 'atendido', 'recepcion', ?, ?)`,
  ).run(AHORA, AHORA);
  db.prepare(
    `INSERT INTO pago (
      id, turno_id, presupuesto_id, monto_centavos, moneda, medio, estado,
      clave_idempotencia, referencia, actor_usuario_id,
      anulado_por_usuario_id, motivo_anulacion, anulado_en,
      created_at, updated_at, deleted_at
    ) VALUES ('pag-1', 'tur-1', null, 100000, 'ARS', 'efectivo', 'cobrado',
      null, null, null, null, null, null, ?, ?, null)`,
  ).run(AHORA, AHORA);
}

function insertarConfigGeneral(
  db: DatabaseSync,
  id: string,
  pct: number,
  deleted = false,
): void {
  db.prepare(
    `INSERT INTO profesional_comision (id, profesional_id, pct_general, created_at, updated_at, deleted_at)
     VALUES (?, 'prof-1', ?, ?, ?, ?)`,
  ).run(id, pct, AHORA, AHORA, deleted ? AHORA : null);
}

/** Período fijo para probar la UNIQUE activa del período exacto. */
const PERIODO_FIJO_DESDE = '2026-11-01T00:00:00.000Z';

/** Cada cabecera sembrada usa un período distinto (UNIQUE activa real en todo el archivo). */
let periodoSecuencial = 0;
function proximoDesde(): string {
  periodoSecuencial += 1;
  const dia = String(periodoSecuencial).padStart(2, '0');
  return `2026-11-${dia}T00:00:00.000Z`;
}

function insertarLiquidacion(
  db: DatabaseSync,
  id: string,
  fila: {
    desde?: string;
    estado?: 'borrador' | 'confirmada';
    items?: number;
    ajustes?: number;
    total?: number;
    saldo?: number;
    hasta?: string;
  } = {},
): void {
  const estado = fila.estado ?? 'borrador';
  const items = fila.items ?? 0;
  const ajustes = fila.ajustes ?? 0;
  const total = fila.total ?? items - ajustes;
  const saldo =
    fila.saldo === undefined
      ? estado === 'borrador'
        ? 0
        : Math.max(0, ajustes - items)
      : fila.saldo;
  const desde = fila.desde ?? proximoDesde();
  const hasta = fila.hasta ?? '2026-11-30T00:00:00.000Z';
  db.prepare(
    `INSERT INTO liquidacion_comision (
      id, profesional_id, desde, hasta, estado,
      monto_items_centavos, monto_ajustes_centavos, monto_total_centavos,
      saldo_compensacion_centavos, fingerprint, created_at, updated_at
    ) VALUES (?, 'prof-1', ?, ?, ?, ?, ?, ?, ?, 'hash-ficticio', ?, ?)`,
  ).run(id, desde, hasta, estado, items, ajustes, total, saldo, AHORA, AHORA);
}

function insertarItem(
  db: DatabaseSync,
  id: string,
  liqId: string,
  pagoId = 'pag-1',
): void {
  db.prepare(
    `INSERT INTO liquidacion_comision_item (
      id, liquidacion_id, pago_id, turno_id, fecha_contable, monto_cobro_centavos,
      pct_aplicado, regla_aplicada, monto_comision_centavos, created_at
    ) VALUES (?, ?, ?, 'tur-1', '2026-11-05', 100000, 20, 'general', 20000, ?)`,
  ).run(id, liqId, pagoId, AHORA);
}

function insertarReservado(
  db: DatabaseSync,
  args: {
    id: string;
    liqId: string;
    itemOrigenId: string;
    tipo?: 'anulacion_cobro' | 'saldo_arrastre';
    monto?: number;
  },
): void {
  db.prepare(
    `INSERT INTO liquidacion_comision_ajuste (
      id, liquidacion_id, item_origen_id, pago_id, tipo_ajuste,
      monto_ajuste_centavos, monto_compensado_centavos, estado_ajuste,
      compensado_en, created_at, updated_at
    ) VALUES (?, ?, ?, 'pag-1', ?, ?, 0, 'reservado', null, ?, ?)`,
  ).run(args.id, args.liqId, args.itemOrigenId, args.tipo ?? 'anulacion_cobro', args.monto ?? 20000, AHORA, AHORA);
}

function consumirReserva(db: DatabaseSync, ajusteId: string): void {
  db.prepare(
    `UPDATE liquidacion_comision_ajuste
     SET estado_ajuste = 'consumido', compensado_en = ?, monto_compensado_centavos = 10000
     WHERE id = ?`,
  ).run(AHORA, ajusteId);
}

function contar(db: DatabaseSync, tabla: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM ${tabla}`)
    .get() as { c: number };
  return row.c;
}

describe('Migración 012 - comisiones (C-13)', () => {
  it('Dado MIGRATIONS Cuando lista migraciones Entonces incluye 011 y 012 al final', () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(ids).toContain('011');
    expect(ids).toContain('012');
    expect(ids[ids.length - 1]).toBe('016');
  });

  it('Dado BD nueva Cuando corre runMigrations Entonces crea las 6 tablas de C-13', () => {
    const db = new DatabaseSync(':memory:');
    try {
      runMigrations(db);
      const tablas = (
        db
          .prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name IN (
              'profesional_comision', 'profesional_comision_tratamiento',
              'liquidacion_comision', 'liquidacion_comision_item',
              'liquidacion_comision_ajuste', 'liquidacion_comision_evento'
            )`,
          )
          .all() as { name: string }[]
      ).map((r) => r.name);
      expect(tablas).toHaveLength(6);
    } finally {
      db.close();
    }
  });

  it('Dado esquema 012 Cuando se inspeccionan columnas Entonces son las diseñadas, sin campos espurios', () => {
    const db = new DatabaseSync(':memory:');
    try {
      runMigrations(db);
      expect(columnasTabla(db, 'profesional_comision')).toEqual([
        'id',
        'profesional_id',
        'pct_general',
        'created_at',
        'updated_at',
        'deleted_at',
      ]);
      expect(columnasTabla(db, 'profesional_comision_tratamiento')).toEqual([
        'id',
        'profesional_id',
        'prestacion_id',
        'pct',
        'created_at',
        'updated_at',
        'deleted_at',
      ]);
      expect(columnasTabla(db, 'liquidacion_comision')).toEqual([
        'id',
        'profesional_id',
        'desde',
        'hasta',
        'estado',
        'monto_items_centavos',
        'monto_ajustes_centavos',
        'monto_total_centavos',
        'saldo_compensacion_centavos',
        'fingerprint',
        'created_at',
        'updated_at',
        'deleted_at',
      ]);
      expect(columnasTabla(db, 'liquidacion_comision_item')).toEqual([
        'id',
        'liquidacion_id',
        'pago_id',
        'turno_id',
        'fecha_contable',
        'monto_cobro_centavos',
        'pct_aplicado',
        'regla_aplicada',
        'monto_comision_centavos',
        'created_at',
        'deleted_at',
      ]);
      expect(columnasTabla(db, 'liquidacion_comision_ajuste')).toEqual([
        'id',
        'liquidacion_id',
        'item_origen_id',
        'pago_id',
        'tipo_ajuste',
        'monto_ajuste_centavos',
        'monto_compensado_centavos',
        'estado_ajuste',
        'compensado_en',
        'created_at',
        'updated_at',
        'deleted_at',
      ]);
      expect(columnasTabla(db, 'liquidacion_comision_evento')).toEqual([
        'id',
        'liquidacion_id',
        'evento',
        'actor_usuario_id',
        'ocurrido_en',
        'created_at',
      ]);
    } finally {
      db.close();
    }
  });
});

describe('CHECKs de migración 012 (C-13)', () => {
  let db: DatabaseSync;

  const preparar = (): void => {
    const nueva = new DatabaseSync(':memory:');
    runMigrations(nueva);
    sembrarEntidadesBase(nueva);
    db = nueva;
  };

  it('Dado pct_general fuera de rango (o no entero) Cuando se inserta config general Entonces CHECK rechaza', () => {
    preparar();
    expect(() => insertarConfigGeneral(db, 'cfg-a', 101)).toThrow();
    expect(() => insertarConfigGeneral(db, 'cfg-b', -1)).toThrow();
    expect(() => insertarConfigGeneral(db, 'cfg-c', 20.5)).toThrow();
    expect(() => insertarConfigGeneral(db, 'cfg-ok', 20)).not.toThrow();
    db.close();
  });

  it('Dado pct de tratamiento fuera de rango Cuando se inserta Entonces CHECK rechaza', () => {
    preparar();
    expect(() =>
      db
        .prepare(
          `INSERT INTO profesional_comision_tratamiento (id, profesional_id, prestacion_id, pct, created_at, updated_at) VALUES ('trat-1', 'prof-1', 'pres-1', 150, ?, ?)`,
        )
        .run(AHORA, AHORA),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO profesional_comision_tratamiento (id, profesional_id, prestacion_id, pct, created_at, updated_at) VALUES ('trat-2', 'prof-1', 'pres-1', 15, ?, ?)`,
        )
        .run(AHORA, AHORA),
    ).not.toThrow();
    db.close();
  });

  it('Dado hasta < desde Cuando se inserta liquidación Entonces CHECK rechaza', () => {
    preparar();
    expect(() =>
      insertarLiquidacion(db, 'liq-x', {
        hasta: '2025-10-01T00:00:00.000Z',
      }),
    ).toThrow();
    db.close();
  });

  it('Dado fecha_contable del ítem Cuando el formato no es YYYY-MM-DD Entonces CHECK GLOB (como en 010) rechaza', () => {
    preparar();
    insertarLiquidacion(db, 'liq-fecha');
    // válido: 'YYYY-MM-DD'
    expect(() =>
      db
        .prepare(
          `INSERT INTO liquidacion_comision_item (id, liquidacion_id, pago_id, turno_id, fecha_contable, monto_cobro_centavos, pct_aplicado, regla_aplicada, monto_comision_centavos, created_at)
           VALUES ('it-f1', 'liq-fecha', 'pag-1', 'tur-1', '2026-11-05', 100000, 20, 'general', 20000, ?)`,
        )
        .run(AHORA),
    ).not.toThrow();
    // inválido: formato dd/mm/yyyy
    expect(() =>
      db
        .prepare(
          `INSERT INTO liquidacion_comision_item (id, liquidacion_id, pago_id, turno_id, fecha_contable, monto_cobro_centavos, pct_aplicado, regla_aplicada, monto_comision_centavos, created_at)
           VALUES ('it-f2', 'liq-fecha', 'pag-1', 'tur-1', '05/11/2026', 100000, 20, 'general', 20000, ?)`,
        )
        .run(AHORA),
    ).toThrow();
    // inválido: timestamp ISO completo (GLOB exige exactamente YYYY-MM-DD, igual que movimiento_caja de 010)
    expect(() =>
      db
        .prepare(
          `INSERT INTO liquidacion_comision_item (id, liquidacion_id, pago_id, turno_id, fecha_contable, monto_cobro_centavos, pct_aplicado, regla_aplicada, monto_comision_centavos, created_at)
           VALUES ('it-f3', 'liq-fecha', 'pag-1', 'tur-1', '2026-11-05T10:00:00.000Z', 100000, 20, 'general', 20000, ?)`,
        )
        .run(AHORA),
    ).toThrow();
    db.close();
  });

  it('Dado neto que no cuadra con sus componentes Cuando se inserta cabecera Entonces CHECK de identidad rechaza', () => {
    preparar();
    expect(() =>
      insertarLiquidacion(db, 'liq-neto', { items: 20000, ajustes: 5000, total: 12345 }),
    ).toThrow();
    db.close();
  });

  it('Dado saldo_compensacion incompatible con el estado Cuando se inserta Entonces CHECK de identidad del saldo rechaza', () => {
    preparar();
    // borrador con saldo distinto de 0
    expect(() =>
      insertarLiquidacion(db, 'liq-s1', { estado: 'borrador', saldo: 5000 }),
    ).toThrow();
    // confirmada con saldo distinto de max(0, ajustes - items)
    expect(() =>
      insertarLiquidacion(db, 'liq-s2', {
        estado: 'confirmada',
        items: 10000,
        ajustes: 15000,
        saldo: 4000,
      }),
    ).toThrow();
    expect(() =>
      insertarLiquidacion(db, 'liq-s3', {
        estado: 'confirmada',
        items: 10000,
        ajustes: 3000,
        saldo: 7000,
      }),
    ).toThrow();
    // casos legítimos
    expect(() =>
      insertarLiquidacion(db, 'liq-ok1', {
        estado: 'confirmada',
        items: 10000,
        ajustes: 15000,
        total: -5000,
        saldo: 5000,
      }),
    ).not.toThrow();
    expect(() =>
      insertarLiquidacion(db, 'liq-ok2', {
        estado: 'confirmada',
        items: 10000,
        ajustes: 3000,
        saldo: 0,
      }),
    ).not.toThrow();
    db.close();
  });

  it('Dado componentes de monto negativos Cuando se insertan Entonces CHECKs rechazan', () => {
    preparar();
    expect(() =>
      insertarLiquidacion(db, 'liq-1', { items: -1, ajustes: 0, total: -1, saldo: 0 }),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO liquidacion_comision (id, profesional_id, desde, hasta, estado, monto_items_centavos, monto_ajustes_centavos, monto_total_centavos, saldo_compensacion_centavos, fingerprint, created_at, updated_at)
           VALUES ('liq-2', 'prof-1', '2026-11-01T00:00:00.000Z', '2026-11-30T00:00:00.000Z', 'borrador', 0, -5, 5, 0, 'hash-ficticio', ?, ?)`,
        )
        .run(AHORA, AHORA),
    ).toThrow();
    db.close();
  });

  it('Dado ajuste con monto_ajuste <= 0 o tipos inválidos Cuando se inserta Entonces CHECKs rechazan', () => {
    preparar();
    insertarLiquidacion(db, 'liq-A');
    insertarItem(db, 'it-1', 'liq-A');
    // tipo_ajuste fuera de los dos valores declarados
    expect(() =>
      db
        .prepare(
          `INSERT INTO liquidacion_comision_ajuste (id, liquidacion_id, item_origen_id, pago_id, tipo_ajuste, monto_ajuste_centavos, monto_compensado_centavos, estado_ajuste, compensado_en, created_at, updated_at)
           VALUES ('aj-t1', 'liq-A', 'it-1', 'pag-1', 'otro_tipo', 20000, 0, 'reservado', null, ?, ?)`,
        )
        .run(AHORA, AHORA),
    ).toThrow();
    db.close();
  });

  it('Dado monto_ajuste 0 o negativo Cuando se inserta ajuste Entonces CHECK (> 0) rechaza', () => {
    preparar();
    insertarLiquidacion(db, 'liq-A');
    insertarItem(db, 'it-1', 'liq-A');
    expect(() =>
      db
        .prepare(
          `INSERT INTO liquidacion_comision_ajuste (id, liquidacion_id, item_origen_id, pago_id, tipo_ajuste, monto_ajuste_centavos, monto_compensado_centavos, estado_ajuste, compensado_en, created_at, updated_at)
           VALUES ('aj-c1', 'liq-A', 'it-1', 'pag-1', 'anulacion_cobro', 0, 0, 'reservado', null, ?, ?)`,
        )
        .run(AHORA, AHORA),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO liquidacion_comision_ajuste (id, liquidacion_id, item_origen_id, pago_id, tipo_ajuste, monto_ajuste_centavos, monto_compensado_centavos, estado_ajuste, compensado_en, created_at, updated_at)
           VALUES ('aj-c2', 'liq-A', 'it-1', 'pag-1', 'anulacion_cobro', -100, 0, 'reservado', null, ?, ?)`,
        )
        .run(AHORA, AHORA),
    ).toThrow();
    db.close();
  });

  it('Dado monto_compensado fuera de [0, monto_ajuste] Cuando se inserta Entonces CHECK rechaza', () => {
    preparar();
    insertarLiquidacion(db, 'liq-A');
    insertarItem(db, 'it-1', 'liq-A');
    expect(() =>
      db
        .prepare(
          `INSERT INTO liquidacion_comision_ajuste (id, liquidacion_id, item_origen_id, pago_id, tipo_ajuste, monto_ajuste_centavos, monto_compensado_centavos, estado_ajuste, compensado_en, created_at, updated_at)
           VALUES ('aj-x1', 'liq-A', 'it-1', 'pag-1', 'anulacion_cobro', 5000, 5001, 'consumido', ?, ?)`,
        )
        .run(AHORA, AHORA, AHORA),
    ).toThrow();
    // compensado == monto_ajuste es legítimo
    expect(() =>
      db
        .prepare(
          `INSERT INTO liquidacion_comision_ajuste (id, liquidacion_id, item_origen_id, pago_id, tipo_ajuste, monto_ajuste_centavos, monto_compensado_centavos, estado_ajuste, compensado_en, created_at, updated_at)
           VALUES ('aj-x2', 'liq-A', 'it-1', 'pag-1', 'anulacion_cobro', 5000, 5000, 'consumido', ?, ?, ?)`,
        )
        .run(AHORA, AHORA, AHORA),
    ).not.toThrow();
    db.close();
  });

  it('Dado consumo sin compensado_en o reservado con tipo inválido/estado inválido Cuando se inserta Entonces CHECK rechaza', () => {
    preparar();
    insertarLiquidacion(db, 'liq-A');
    insertarItem(db, 'it-1', 'liq-A');
    // consumido sin compensado_en
    expect(() =>
      db
        .prepare(
          `INSERT INTO liquidacion_comision_ajuste (id, liquidacion_id, item_origen_id, pago_id, tipo_ajuste, monto_ajuste_centavos, monto_compensado_centavos, estado_ajuste, compensado_en, created_at, updated_at)
           VALUES ('aj-e1', 'liq-A', 'it-1', 'pag-1', 'anulacion_cobro', 5000, 2000, 'consumido', null, ?, ?)`,
        )
        .run(AHORA, AHORA),
    ).toThrow();
    // estado_ajuste inválido
    expect(() =>
      db
        .prepare(
          `INSERT INTO liquidacion_comision_ajuste (id, liquidacion_id, item_origen_id, pago_id, tipo_ajuste, monto_ajuste_centavos, monto_compensado_centavos, estado_ajuste, compensado_en, created_at, updated_at)
           VALUES ('aj-e2', 'liq-A', 'it-1', 'pag-1', 'anulacion_cobro', 5000, 0, 'pendiente', null, ?, ?)`,
        )
        .run(AHORA, AHORA),
    ).toThrow();
    // reservado con compensado_en nulo es legítimo
    expect(() =>
      db
        .prepare(
          `INSERT INTO liquidacion_comision_ajuste (id, liquidacion_id, item_origen_id, pago_id, tipo_ajuste, monto_ajuste_centavos, monto_compensado_centavos, estado_ajuste, compensado_en, created_at, updated_at)
           VALUES ('aj-e3', 'liq-A', 'it-1', 'pag-1', 'anulacion_cobro', 5000, 0, 'reservado', null, ?, ?)`,
        )
        .run(AHORA, AHORA),
    ).not.toThrow();
    db.close();
  });
});

describe('Índices únicos parciales de migración 012 (C-13)', () => {
  let db: DatabaseSync;

  const preparar = (): void => {
    const nueva = new DatabaseSync(':memory:');
    runMigrations(nueva);
    sembrarEntidadesBase(nueva);
    db = nueva;
  };

  it('Dado config general activa Cuando se duplica el profesional Entonces rechaza; tras baja lógica permite nueva', () => {
    preparar();
    insertarConfigGeneral(db, 'cfg-1', 20);
    expect(() => insertarConfigGeneral(db, 'cfg-2', 25)).toThrow();
    db.prepare(
      `UPDATE profesional_comision SET deleted_at = ? WHERE id = 'cfg-1'`,
    ).run(AHORA);
    expect(() => insertarConfigGeneral(db, 'cfg-2', 25)).not.toThrow();
    db.close();
  });

  it('Dado par (profesional, prestación) activo en tratamientos Cuando se duplica Entonces rechaza; baja lógica libera', () => {
    preparar();
    db.prepare(
      `INSERT INTO profesional_comision_tratamiento (id, profesional_id, prestacion_id, pct, created_at, updated_at, deleted_at) VALUES ('trat-a', 'prof-1', 'pres-1', 50, ?, ?, null)`,
    ).run(AHORA, AHORA);
    expect(() =>
      db
        .prepare(
          `INSERT INTO profesional_comision_tratamiento (id, profesional_id, prestacion_id, pct, created_at, updated_at, deleted_at) VALUES ('trat-b', 'prof-1', 'pres-1', 30, ?, ?, null)`,
        )
        .run(AHORA, AHORA),
    ).toThrow();
    db.prepare(
      `UPDATE profesional_comision_tratamiento SET deleted_at = ? WHERE id = 'trat-a'`,
    ).run(AHORA);
    expect(() =>
      db
        .prepare(
          `INSERT INTO profesional_comision_tratamiento (id, profesional_id, prestacion_id, pct, created_at, updated_at, deleted_at) VALUES ('trat-b', 'prof-1', 'pres-1', 30, ?, ?, null)`,
        )
        .run(AHORA, AHORA),
    ).not.toThrow();
    db.close();
  });

  it('Dado liquidación activa del mismo período Cuando se duplica Entonces UNIQUE activa rechaza; baja lógica libera', () => {
    preparar();
    insertarLiquidacion(db, 'liq-1', { desde: PERIODO_FIJO_DESDE });
    expect(() =>
      insertarLiquidacion(db, 'liq-2', { desde: PERIODO_FIJO_DESDE }),
    ).toThrow();
    db.prepare(
      `UPDATE liquidacion_comision SET deleted_at = ? WHERE id = 'liq-1'`,
    ).run(AHORA);
    expect(() => insertarLiquidacion(db, 'liq-2')).not.toThrow();
    db.close();
  });

  it('Dado item activo de un mismo pago Cuando se duplica Entonces UNIQUE (pago_id) rechaza; baja lógica libera', () => {
    preparar();
    insertarLiquidacion(db, 'liq-1');
    insertarItem(db, 'it-1', 'liq-1');
    expect(() => insertarItem(db, 'it-2', 'liq-1')).toThrow();
    db.prepare(
      `UPDATE liquidacion_comision_item SET deleted_at = ? WHERE id = 'it-1'`,
    ).run(AHORA);
    expect(() => insertarItem(db, 'it-2', 'liq-1')).not.toThrow();
    db.close();
  });

  it('Dado reserva de ajuste Cuando dos borradores activos intentan reservar el mismo item_origen Entonces la segunda viola el índice parcial', () => {
    preparar();
    insertarLiquidacion(db, 'liq-1');
    insertarItem(db, 'it-1', 'liq-1');
    insertarLiquidacion(db, 'liq-2');
    insertarReservado(db, { id: 'aj-1', liqId: 'liq-1', itemOrigenId: 'it-1' });
    expect(() =>
      insertarReservado(db, { id: 'aj-2', liqId: 'liq-2', itemOrigenId: 'it-1' }),
    ).toThrow();
    expect(() =>
      insertarReservado(db, { id: 'aj-3', liqId: 'liq-1', itemOrigenId: 'it-1' }),
    ).toThrow();
    // filas dadas de baja no bloquean una nueva reserva
    db.prepare(
      `UPDATE liquidacion_comision_ajuste SET deleted_at = ? WHERE id = 'aj-1'`,
    ).run(AHORA);
    expect(() =>
      insertarReservado(db, { id: 'aj-4', liqId: 'liq-2', itemOrigenId: 'it-1' }),
    ).not.toThrow();
    // persisten solo las filas válidas: la reserva original (dada de baja) y la nueva
    expect(contar(db, 'liquidacion_comision_ajuste')).toBe(2);
    db.close();
  });

  it('Dado fila consumido Cuando se reserva de nuevo el mismo item_origen (arrastre residual) Entonces la unicidad lo permite', () => {
    preparar();
    insertarLiquidacion(db, 'liq-1');
    insertarItem(db, 'it-1', 'liq-1');
    insertarReservado(db, {
      id: 'aj-1',
      liqId: 'liq-1',
      itemOrigenId: 'it-1',
      monto: 15000,
    });
    consumirReserva(db, 'aj-1');
    // arrastre: un nuevo borrador reserva el residual sobre el MISMO item_origen
    insertarLiquidacion(db, 'liq-2', { estado: 'borrador' });
    expect(() =>
      insertarReservado(db, {
        id: 'aj-2',
        liqId: 'liq-2',
        itemOrigenId: 'it-1',
        tipo: 'saldo_arrastre',
        monto: 5000,
      }),
    ).not.toThrow();
    // sin romper la unicidad: un tercer ajuste del mismo origen en liq-2 rechaza
    expect(() =>
      insertarReservado(db, {
        id: 'aj-3',
        liqId: 'liq-2',
        itemOrigenId: 'it-1',
        tipo: 'saldo_arrastre',
        monto: 5000,
      }),
    ).toThrow();
    expect(contar(db, 'liquidacion_comision_ajuste')).toBe(2);
    db.close();
  });
});

describe('Triggers, FKs e integridad de migración 012 (C-13)', () => {
  let db: DatabaseSync;

  const preparar = (): void => {
    const nueva = new DatabaseSync(':memory:');
    runMigrations(nueva);
    sembrarEntidadesBase(nueva);
    db = nueva;
  };

  it('Dado evento de liquidación Cuando se intenta UPDATE o DELETE Entonces los triggers abortan', () => {
    preparar();
    insertarLiquidacion(db, 'liq-1');
    db.prepare(
      `INSERT INTO liquidacion_comision_evento (id, liquidacion_id, evento, actor_usuario_id, ocurrido_en, created_at) VALUES ('evt-1', 'liq-1', 'generada', 'usr-1', ?, ?)`,
    ).run(AHORA, AHORA);
    expect(() =>
      db
        .prepare(
          `UPDATE liquidacion_comision_evento SET evento = 'confirmada' WHERE id = 'evt-1'`,
        )
        .run(),
    ).toThrow(/liquidacion_comision_evento es insert-only/);
    expect(() =>
      db
        .prepare(`DELETE FROM liquidacion_comision_evento WHERE id = 'evt-1'`)
        .run(),
    ).toThrow(/liquidacion_comision_evento es insert-only/);
    // evento inválido también rechazado por CHECK
    expect(() =>
      db
        .prepare(
          `INSERT INTO liquidacion_comision_evento (id, liquidacion_id, evento, actor_usuario_id, ocurrido_en, created_at) VALUES ('evt-2', 'liq-1', 'anulada', 'usr-1', ?, ?)`,
        )
        .run(AHORA, AHORA),
    ).toThrow();
    db.close();
  });

  it('Dado referencias inexistentes Cuando se insertan filas de 012 Entonces las FKs rechazan y foreign_key_check queda vacío', () => {
    preparar();
    // cabecera con profesional inexistente
    expect(() =>
      db
        .prepare(
          `INSERT INTO liquidacion_comision (id, profesional_id, desde, hasta, estado, monto_items_centavos, monto_ajustes_centavos, monto_total_centavos, saldo_compensacion_centavos, fingerprint, created_at, updated_at)
           VALUES ('liq-fk1', 'prof-404', '2026-11-01T00:00:00.000Z', '2026-11-30T00:00:00.000Z', 'borrador', 0, 0, 0, 0, 'hash', ?, ?)`,
        )
        .run(AHORA, AHORA),
    ).toThrow();
    insertarLiquidacion(db, 'liq-1');
    // item con pago inexistente
    expect(() => insertarItem(db, 'it-fk2', 'liq-1', 'pag-404')).toThrow();
    insertarItem(db, 'it-1', 'liq-1');
    // ajuste con item_origen inexistente
    expect(() =>
      insertarReservado(db, { id: 'aj-fk3', liqId: 'liq-1', itemOrigenId: 'it-404' }),
    ).toThrow();
    insertarReservado(db, { id: 'aj-1', liqId: 'liq-1', itemOrigenId: 'it-1' });
    consumirReserva(db, 'aj-1');
    // evento con actor inexistente
    expect(() =>
      db
        .prepare(
          `INSERT INTO liquidacion_comision_evento (id, liquidacion_id, evento, actor_usuario_id, ocurrido_en, created_at) VALUES ('evt-fk4', 'liq-1', 'generada', 'usr-404', ?, ?)`,
        )
        .run(AHORA, AHORA),
    ).toThrow();
    // la cadena sembrada es íntegra
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });

  it('Dado transacción con violación de constraint Cuando ROLLBACK Entonces el borrador fallido no persiste nada', () => {
    preparar();
    insertarLiquidacion(db, 'liq-base');
    insertarItem(db, 'it-base', 'liq-base');
    db.exec('BEGIN IMMEDIATE');
    let fallo = false;
    try {
      insertarLiquidacion(db, 'liq-fallida');
      insertarItem(db, 'it-fallida', 'liq-fallida');
      insertarReservado(db, {
        id: 'aj-fallida',
        liqId: 'liq-fallida',
        itemOrigenId: 'it-fallida',
      });
      // violación: compensado > ajuste
      db
        .prepare(
          `UPDATE liquidacion_comision_ajuste SET monto_compensado_centavos = 99999 WHERE id = 'aj-fallida'`,
        )
        .run();
      db.exec('COMMIT'); // no debió llegar
    } catch {
      fallo = true;
      expect(() => db.exec('ROLLBACK')).not.toThrow();
    }
    expect(fallo).toBe(true);
    expect(contar(db, 'liquidacion_comision')).toBe(1);
    expect(contar(db, 'liquidacion_comision_item')).toBe(1);
    expect(contar(db, 'liquidacion_comision_ajuste')).toBe(0);
    db.close();
  });

  it('Dado esquema completo Cuando se verifica integridad 010/011 Entonces siguen intactas y coherentes', () => {
    preparar();
    // 010: pago exige al menos una aplicación (turno o presupuesto)
    expect(() =>
      db
        .prepare(
          `INSERT INTO pago (id, turno_id, presupuesto_id, monto_centavos, moneda, medio, estado, clave_idempotencia, referencia, actor_usuario_id, anulado_por_usuario_id, motivo_anulacion, anulado_en, created_at, updated_at, deleted_at)
           VALUES ('pag-404', null, null, 5000, 'ARS', 'efectivo', 'pendiente', null, null, null, null, null, null, ?, ?, null)`,
        )
        .run(AHORA, AHORA),
    ).toThrow();
    // 011: hasta < desde siguió rechazando en liquidación de reintegros
    expect(() =>
      db
        .prepare(
          `INSERT INTO obra_social_liquidacion (id, obra_social_plan_id, desde, hasta, estado, monto_total_centavos, generada_por_usuario_id, created_at, updated_at) VALUES ('osl-1', 'osp-1', '2026-11-30T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 'borrador', 0, 'usr-1', ?, ?)`,
        )
        .run(AHORA, AHORA),
    ).toThrow();
    // y una 011 válida convive con 012
    db.prepare(
      `INSERT INTO obra_social_liquidacion (id, obra_social_plan_id, desde, hasta, estado, monto_total_centavos, generada_por_usuario_id, created_at, updated_at) VALUES ('osl-2', 'osp-1', '2026-11-01T00:00:00.000Z', '2026-11-30T00:00:00.000Z', 'borrador', 0, 'usr-1', ?, ?)`,
    ).run(AHORA, AHORA);
    // una 012 válida convive con una 011 válida en el mismo esquema
    insertarLiquidacion(db, 'liq-1');
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(
      contar(db, 'liquidacion_comision') + contar(db, 'obra_social_liquidacion'),
    ).toBe(2);
    db.close();
  });
});
