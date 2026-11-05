/**
 * Tasks 3.1-3.4: servicio de cobros de caja (C-11) — escenarios de specs
 * caja/pagos (registro, aplicación, topes, idempotencia, anulación,
 * saldos/deudas) y cierre-diario (asignación post-cierre, D3).
 * SQLite REAL en memoria (R12: transacciones NEVER mockeadas; el proveedor
 * MP no interviene en este archivo). Datos estrictamente ficticios (R1).
 */
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { CajaError } from '../src/shared/errors.js';
import {
  diaContableHoy,
  insertConcepto,
  movimientosDePago,
  seedCajaBase,
  servicioCaja,
} from './helpers/caja-fixtures.js';

/** Recorta el primer CajaError lanzado (o re-lanza si nada falló). */
function capturar(fn: () => unknown): CajaError {
  try {
    fn();
  } catch (err) {
    if (err instanceof CajaError) return err;
    throw err;
  }
  throw new Error('la operación debería haber fallado con CajaError');
}

/** Resta días enteros sobre una fecha `YYYY-MM-DD` en aritmética UTC. */
function restarDias(dia: string, dias: number): string {
  const anio = Number.parseInt(dia.slice(0, 4), 10);
  const mes = Number.parseInt(dia.slice(5, 7), 10);
  const numeroDia = Number.parseInt(dia.slice(8, 10), 10);
  return new Date(Date.UTC(anio, mes - 1, numeroDia - dias))
    .toISOString()
    .slice(0, 10);
}

describe('Registro de cobro — aplicación y validaciones (spec caja/pagos)', () => {
  it('Dado un concepto aceptado Cuando registro un cobro de efectivo aplicado al presupuesto Entonces queda cobrado con movimiento de caja trazable (fecha contable = hoy, sin desvío)', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    insertConcepto(db, {
      id: 'pres-cob-1',
      turnoId: 'turno-caja',
      totalCentavos: 100000,
      coberturaCentavos: 40000,
      saldoCentavos: 60000,
    });
    const service = servicioCaja(db);

    const resultado = service.registrarCobro({
      montoCentavos: 30000,
      medio: 'efectivo',
      presupuestoId: 'pres-cob-1',
      actorUsuarioId: 'user-caja',
    });

    expect(resultado.idempotente).toBe(false);
    expect(resultado.pago).toMatchObject({
      monto_centavos: 30000,
      moneda: 'ARS',
      medio: 'efectivo',
      estado: 'cobrado',
      presupuesto_id: 'pres-cob-1',
      actor_usuario_id: 'user-caja',
    });
    const hoy = diaContableHoy();
    expect(movimientosDePago(db, resultado.pago.id)).toEqual([
      {
        tipo: 'cobro',
        monto_centavos: 30000,
        aplicado_en: hoy,
        motivo_asignacion: null,
      },
    ]);
    db.close();
  });

  it('Dado un presupuesto no aceptado Cuando aplico el cobro Entonces responde 422 aplicacion_requerida y no persiste', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    insertConcepto(db, {
      id: 'pres-borrador',
      turnoId: 'turno-caja',
      estado: 'borrador',
      totalCentavos: 100000,
      coberturaCentavos: 0,
      saldoCentavos: 100000,
    });
    const service = servicioCaja(db);

    const err = capturar(() =>
      service.registrarCobro({
        montoCentavos: 10000,
        medio: 'efectivo',
        presupuestoId: 'pres-borrador',
        actorUsuarioId: 'user-caja',
      }),
    );
    expect(err.status).toBe(422);
    expect(err.code).toBe('aplicacion_requerida');
    const n = db.prepare('SELECT COUNT(*) AS n FROM pago').get() as { n: number };
    expect(n.n).toBe(0);
    db.close();
  });

  it('Dado un presupuesto inexistente Cuando aplico el cobro Entonces responde 400 validacion', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const service = servicioCaja(db);

    const err = capturar(() =>
      service.registrarCobro({
        montoCentavos: 10000,
        medio: 'efectivo',
        presupuestoId: 'pres-quimera',
        actorUsuarioId: 'user-caja',
      }),
    );
    expect(err.status).toBe(400);
    expect(err.code).toBe('validacion');
    expect(err.detalle).not.toBeUndefined();
    db.close();
  });

  it('Dado un cobro directo sobre turno inexistente Cuando registro Entonces responde 400 validacion', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const service = servicioCaja(db);

    const err = capturar(() =>
      service.registrarCobro({
        montoCentavos: 10000,
        medio: 'efectivo',
        turnoId: 'turno-quimera',
        actorUsuarioId: 'user-caja',
      }),
    );
    expect(err.status).toBe(400);
    expect(err.code).toBe('validacion');
    db.close();
  });

  it('Dado un turno con conceptos aceptado Cuando intento cobro directo Entonces 422 aplicacion_requerida (no doble contabilidad del concepto); sin conceptos Entonces el cobro directo es válido', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    insertConcepto(db, {
      id: 'pres-directo-1',
      turnoId: 'turno-caja',
      totalCentavos: 100000,
      coberturaCentavos: 0,
      saldoCentavos: 100000,
    });
    const service = servicioCaja(db);

    const err = capturar(() =>
      service.registrarCobro({
        montoCentavos: 10000,
        medio: 'efectivo',
        turnoId: 'turno-caja',
        actorUsuarioId: 'user-caja',
      }),
    );
    expect(err.status).toBe(422);
    expect(err.code).toBe('aplicacion_requerida');

    // sobre un turno sin conceptos: cobro directo aceptado
    db.prepare(
      `INSERT INTO paciente (id, nombre, obra_social_plan_id, activo, created_at, updated_at)
       VALUES ('pac-libre', 'Paciente Libre Ficticio', NULL, 1, datetime('now'), datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at)
       VALUES ('turno-libre', 'prof-caja', 'sillon-caja', 'pac-libre',
               '2026-11-02T10:00:00.000Z', '2026-11-02T10:30:00.000Z',
               'confirmado', 'recepcion', datetime('now'), datetime('now'))`,
    ).run();
    const directo = service.registrarCobro({
      montoCentavos: 12000,
      medio: 'tarjeta',
      turnoId: 'turno-libre',
      actorUsuarioId: 'user-caja',
    });
    expect(directo.pago.estado).toBe('cobrado');
    expect(directo.pago.turno_id).toBe('turno-libre');
    db.close();
  });

  it('Dado un cobro a obra social sobre turno directo (sin concepto) Cuando registro Entonces 422 aplicacion_requerida (OS aplica solo a un concepto)', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const service = servicioCaja(db);

    const err = capturar(() =>
      service.registrarCobro({
        montoCentavos: 10000,
        medio: 'obra_social',
        turnoId: 'turno-caja',
        actorUsuarioId: 'user-caja',
      }),
    );
    expect(err.status).toBe(422);
    expect(err.code).toBe('aplicacion_requerida');
    db.close();
  });

  it('Dado un cobro sin aplicación, con medio inválido o con monto no positivo Cuando registro Entonces 400 validacion en cada caso', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const service = servicioCaja(db);

    expect(
      capturar(() =>
        service.registrarCobro({
          montoCentavos: 1000,
          medio: 'efectivo',
          actorUsuarioId: 'user-caja',
        }),
      ).code,
    ).toBe('validacion');
    expect(
      capturar(() =>
        service.registrarCobro({
          montoCentavos: 1000,
          medio: 'vale-de-cambio',
          turnoId: 'turno-caja',
          actorUsuarioId: 'user-caja',
        }),
      ).code,
    ).toBe('validacion');
    expect(
      capturar(() =>
        service.registrarCobro({
          montoCentavos: 0,
          medio: 'efectivo',
          turnoId: 'turno-caja',
          actorUsuarioId: 'user-caja',
        }),
      ).code,
    ).toBe('validacion');
    expect(
      capturar(() =>
        service.registrarCobro({
          montoCentavos: 1500.75,
          medio: 'efectivo',
          turnoId: 'turno-caja',
          actorUsuarioId: 'user-caja',
        }),
      ).code,
    ).toBe('validacion');
    db.close();
  });

  it('Dado cobros parciales Cuando agoto el saldo del concepto Entonces se aceptan hasta agotarlo y el excedente responde 422 monto_excede_saldo', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    insertConcepto(db, {
      id: 'pres-parcial',
      turnoId: 'turno-caja',
      totalCentavos: 150000,
      coberturaCentavos: 0,
      saldoCentavos: 90000,
    });
    const service = servicioCaja(db);

    service.registrarCobro({
      montoCentavos: 50000,
      medio: 'efectivo',
      presupuestoId: 'pres-parcial',
      actorUsuarioId: 'user-caja',
    });
    service.registrarCobro({
      montoCentavos: 40000,
      medio: 'tarjeta',
      presupuestoId: 'pres-parcial',
      actorUsuarioId: 'user-caja',
    });

    const err = capturar(() =>
      service.registrarCobro({
        montoCentavos: 1,
        medio: 'efectivo',
        presupuestoId: 'pres-parcial',
        actorUsuarioId: 'user-caja',
      }),
    );
    expect(err.status).toBe(422);
    expect(err.code).toBe('monto_excede_saldo');

    const saldo = service.saldoPorTurno('turno-caja');
    expect(saldo.saldo_restante).toBe(0);
    expect(saldo.cobrado_ars).toBe(90000);
    db.close();
  });

  it('Dado un cobro a obra social que supera la cobertura restante Cuando registro Entonces 422 cobro_os_excede_cobertura y el cobro OS válido no reduce el saldo del paciente (deuda)', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    insertConcepto(db, {
      id: 'pres-os-1',
      turnoId: 'turno-caja',
      totalCentavos: 150000,
      coberturaCentavos: 90000,
      saldoCentavos: 60000,
    });
    const service = servicioCaja(db);

    const err = capturar(() =>
      service.registrarCobro({
        montoCentavos: 100000,
        medio: 'obra_social',
        presupuestoId: 'pres-os-1',
        actorUsuarioId: 'user-caja',
      }),
    );
    expect(err.status).toBe(422);
    expect(err.code).toBe('cobro_os_excede_cobertura');

    // hasta la cobertura: se acepta
    service.registrarCobro({
      montoCentavos: 90000,
      medio: 'obra_social',
      presupuestoId: 'pres-os-1',
      actorUsuarioId: 'user-caja',
    });
    // un centavo más de cobertura también excede
    const err2 = capturar(() =>
      service.registrarCobro({
        montoCentavos: 1,
        medio: 'obra_social',
        presupuestoId: 'pres-os-1',
        actorUsuarioId: 'user-caja',
      }),
    );
    expect(err2.code).toBe('cobro_os_excede_cobertura');

    // El cobro OS NO descuenta la deuda del paciente (deuda = saldo bolsillo)
    const deuda = service.deudaPorPaciente('pac-caja');
    expect(deuda.deuda_total_centavos).toBe(60000);
    const saldo = service.saldoPorTurno('turno-caja');
    expect(saldo.cobrado_obra_social).toBe(90000);
    expect(saldo.cobrado_ars).toBe(0);
    db.close();
  });
});

describe('Idempotencia de clave (spec caja/pagos)', () => {
  it('Dado un reenvío con la misma clave y mismos datos Cuando registro el cobro Entonces devuelve el pago original como idempotente sin duplicar movimientos (aun con concepto agotado: la clave se chequea antes de los topes)', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    insertConcepto(db, {
      id: 'pres-idem-1',
      turnoId: 'turno-caja',
      totalCentavos: 120000,
      coberturaCentavos: 0,
      saldoCentavos: 60000,
    });
    const service = servicioCaja(db);

    const primero = service.registrarCobro({
      montoCentavos: 60000,
      medio: 'transferencia',
      presupuestoId: 'pres-idem-1',
      claveIdempotencia: 'clave-idem-data-1',
      actorUsuarioId: 'user-caja',
    });
    expect(primero.idempotente).toBe(false);

    // el concepto quedó agotado (60000 de 60000): un cobro nuevo fallaría,
    // pero el replay idéntico se resuelve por idempotencia antes de los topes.
    const segundo = service.registrarCobro({
      montoCentavos: 60000,
      medio: 'transferencia',
      presupuestoId: 'pres-idem-1',
      claveIdempotencia: 'clave-idem-data-1',
      actorUsuarioId: 'user-caja',
    });
    expect(segundo.idempotente).toBe(true);
    expect(segundo.pago.id).toBe(primero.pago.id);

    const n = db.prepare('SELECT COUNT(*) AS n FROM pago').get() as { n: number };
    expect(n.n).toBe(1);
    expect(movimientosDePago(db, primero.pago.id)).toHaveLength(1);
    db.close();
  });

  it('Dado un reenvío con la misma clave y datos distintos Cuando registro Entonces 409 idempotencia_conflictos', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    insertConcepto(db, {
      id: 'pres-idem-2',
      turnoId: 'turno-caja',
      totalCentavos: 100000,
      coberturaCentavos: 0,
      saldoCentavos: 100000,
    });
    const service = servicioCaja(db);

    service.registrarCobro({
      montoCentavos: 10000,
      medio: 'efectivo',
      presupuestoId: 'pres-idem-2',
      claveIdempotencia: 'clave-conflicto-1',
      actorUsuarioId: 'user-caja',
    });

    // mismo medio+aplicación, monto distinto → conflicto
    expect(
      capturar(() =>
        service.registrarCobro({
          montoCentavos: 20000,
          medio: 'efectivo',
          presupuestoId: 'pres-idem-2',
          claveIdempotencia: 'clave-conflicto-1',
          actorUsuarioId: 'user-caja',
        }),
      ).code,
    ).toBe('idempotencia_conflictos');
    // mismo monto, medio distinto → conflicto
    expect(
      capturar(() =>
        service.registrarCobro({
          montoCentavos: 10000,
          medio: 'tarjeta',
          presupuestoId: 'pres-idem-2',
          claveIdempotencia: 'clave-conflicto-1',
          actorUsuarioId: 'user-caja',
        }),
      ).code,
    ).toBe('idempotencia_conflictos');
    db.close();
  });
});

describe('Anulación con trazabilidad (spec caja/pagos)', () => {
  it('Dado un pago cobrado Cuando lo anulo con motivo Entonces queda anulado con actor/motivo/instante y genera movimiento de anulacion del día', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    insertConcepto(db, {
      id: 'pres-anul-1',
      turnoId: 'turno-caja',
      totalCentavos: 100000,
      coberturaCentavos: 0,
      saldoCentavos: 100000,
    });
    const service = servicioCaja(db);

    const cobro = service.registrarCobro({
      montoCentavos: 70000,
      medio: 'efectivo',
      presupuestoId: 'pres-anul-1',
      actorUsuarioId: 'user-caja',
    });
    const anulado = service.anularPago({
      pagoId: cobro.pago.id,
      actorUsuarioId: 'user-caja',
      motivo: 'error de caja ficticio',
    });

    expect(anulado.estado).toBe('anulado');
    expect(anulado.anulado_por_usuario_id).toBe('user-caja');
    expect(anulado.motivo_anulacion).toBe('error de caja ficticio');
    const movimientos = movimientosDePago(db, cobro.pago.id);
    expect(movimientos).toHaveLength(2);
    expect(movimientos[1]).toMatchObject({
      tipo: 'anulacion',
      monto_centavos: 70000,
      aplicado_en: diaContableHoy(),
    });

    // la anulación devuelve el saldo: vuelve a ser cobrable
    expect(service.saldoPorTurno('turno-caja').saldo_restante).toBe(100000);
    db.close();
  });

  it('Dado pagos en estados no anulables o inexistentes Cuando anulo Entonces 409 anulacion_inconsistente / 404 not_found; motivo vacío → 400 validacion', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    insertConcepto(db, {
      id: 'pres-anul-2',
      turnoId: 'turno-caja',
      totalCentavos: 100000,
      coberturaCentavos: 0,
      saldoCentavos: 100000,
    });
    const service = servicioCaja(db);

    // motivo obligatorio
    const cobro = service.registrarCobro({
      montoCentavos: 20000,
      medio: 'efectivo',
      presupuestoId: 'pres-anul-2',
      actorUsuarioId: 'user-caja',
    });
    expect(
      capturar(() =>
        service.anularPago({ pagoId: cobro.pago.id, actorUsuarioId: 'user-caja', motivo: '   ' }),
      ).code,
    ).toBe('validacion');

    // pago inexistente → 404
    const err404 = capturar(() =>
      service.anularPago({ pagoId: 'pago-quimera', actorUsuarioId: 'user-caja', motivo: 'inexistente' }),
    );
    expect(err404.status).toBe(404);
    expect(err404.code).toBe('not_found');

    // pago pendiente (MP) no es anulable → 409
    db.prepare(
      `INSERT INTO pago (id, turno_id, presupuesto_id, monto_centavos, moneda, medio, estado, created_at, updated_at)
       VALUES ('pago-mp-pendiente', 'turno-caja', NULL, 10000, 'ARS', 'mercadopago', 'pendiente', 'x', 'x')`,
    ).run();
    expect(
      capturar(() =>
        service.anularPago({ pagoId: 'pago-mp-pendiente', actorUsuarioId: 'user-caja', motivo: 'pendiente' }),
      ).code,
    ).toBe('anulacion_inconsistente');

    // segunda anulación sobre ya anulado → 409 idempotente
    service.anularPago({ pagoId: cobro.pago.id, actorUsuarioId: 'user-caja', motivo: 'primera' });
    expect(
      capturar(() =>
        service.anularPago({ pagoId: cobro.pago.id, actorUsuarioId: 'user-caja', motivo: 'segunda' }),
      ).code,
    ).toBe('anulacion_inconsistente');
    db.close();
  });
});

describe('Saldos, deudas e historiales (spec caja/pagos)', () => {
  it('Dado un turno con dos conceptos aceptados y cobros mixtos Cuando consulto saldo Entonces total/saldo/bolsillo/OS reflejan centavos exactos', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    insertConcepto(db, {
      id: 'pres-sald-1',
      turnoId: 'turno-caja',
      totalCentavos: 100000,
      coberturaCentavos: 60000,
      saldoCentavos: 40000,
    });
    insertConcepto(db, {
      id: 'pres-sald-2',
      turnoId: 'turno-caja',
      totalCentavos: 200000,
      coberturaCentavos: 30000,
      saldoCentavos: 200000,
    });
    const service = servicioCaja(db);

    service.registrarCobro({
      montoCentavos: 40000,
      medio: 'efectivo',
      presupuestoId: 'pres-sald-1',
      actorUsuarioId: 'user-caja',
    });
    service.registrarCobro({
      montoCentavos: 50000,
      medio: 'transferencia',
      presupuestoId: 'pres-sald-2',
      actorUsuarioId: 'user-caja',
    });
    service.registrarCobro({
      montoCentavos: 30000,
      medio: 'obra_social',
      presupuestoId: 'pres-sald-2',
      actorUsuarioId: 'user-caja',
    });

    const saldo = service.saldoPorTurno('turno-caja');
    expect(saldo.total_a_cobrar).toBe(240000);
    expect(saldo.saldo_restante).toBe(150000);
    expect(saldo.cobrado_ars).toBe(90000); // bolsillo: 40000 (sald-1) + 50000 (sald-2)
    expect(saldo.cobrado_obra_social).toBe(30000); // OS aparte, no rebaja saldo

    // turno inexistente → 404
    expect(
      capturar(() => service.saldoPorTurno('turno-quimera')).code,
    ).toBe('not_found');
    const turnoInexistente = db
      .prepare(`SELECT COUNT(*) AS n FROM turno WHERE id = 'turno-quimera'`)
      .get() as { n: number };
    expect(turnoInexistente.n).toBe(0);
    db.close();
  });

  it('Dado un paciente con conceptos aceptados (uno parcialmente cobrado) y otro sin turno Cuando consulto deuda Entonces pende por concepto; sin conceptos → deuda 0 sin inventar registros', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    insertConcepto(db, {
      id: 'pres-deuda-1',
      turnoId: 'turno-caja',
      totalCentavos: 100000,
      coberturaCentavos: 0,
      saldoCentavos: 60000,
    });
    insertConcepto(db, {
      id: 'pres-deuda-2',
      turnoId: null, // presupuesto sin turno (C-10)
      totalCentavos: 50000,
      coberturaCentavos: 0,
      saldoCentavos: 30000,
    });
    // un concepto rechazado del mismo paciente NO entra al cálculo
    insertConcepto(db, {
      id: 'pres-deuda-rech',
      turnoId: null,
      estado: 'rechazado',
      totalCentavos: 999000,
      coberturaCentavos: 0,
      saldoCentavos: 999000,
    });
    const service = servicioCaja(db);

    service.registrarCobro({
      montoCentavos: 20000,
      medio: 'tarjeta',
      presupuestoId: 'pres-deuda-1',
      actorUsuarioId: 'user-caja',
    });

    const deuda = service.deudaPorPaciente('pac-caja');
    expect(deuda.paciente_id).toBe('pac-caja');
    expect(deuda.conceptos).toHaveLength(2);
    expect(deuda.deuda_total_centavos).toBe(70000); // (60000-20000) + 30000

    // paciente desconocido: deuda 0 (no 404)
    const vacia = service.deudaPorPaciente('pac-quimera');
    expect(vacia.deuda_total_centavos).toBe(0);
    expect(vacia.conceptos).toEqual([]);
    db.close();
  });

  it('Dado un turno con cobros incluendo anulado Cuando pido historial de turno y de concepto Entonces incluye todos (trazabilidad completa)', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    insertConcepto(db, {
      id: 'pres-hist-1',
      turnoId: 'turno-caja',
      totalCentavos: 100000,
      coberturaCentavos: 0,
      saldoCentavos: 100000,
    });
    const service = servicioCaja(db);
    const c1 = service.registrarCobro({
      montoCentavos: 30000,
      medio: 'efectivo',
      presupuestoId: 'pres-hist-1',
      actorUsuarioId: 'user-caja',
    });
    service.anularPago({ pagoId: c1.pago.id, actorUsuarioId: 'user-caja', motivo: 'a' });
    service.registrarCobro({
      montoCentavos: 30000,
      medio: 'tarjeta',
      presupuestoId: 'pres-hist-1',
      actorUsuarioId: 'user-caja',
    });

    const historialTurno = service.historialPorTurno('turno-caja');
    expect(historialTurno).toHaveLength(2);
    expect(historialTurno.filter((p) => p.estado === 'anulado')).toHaveLength(1);
    expect(service.historialPorConcepto('pres-hist-1')).toHaveLength(2);

    expect(
      capturar(() => service.historialPorTurno('turno-quimera')).status,
    ).toBe(404);
    expect(
      capturar(() => service.historialPorConcepto('pres-quimera')).status,
    ).toBe(404);
    db.close();
  });
});

describe('Asignación post-cierre (spec cierre-diario, design D3)', () => {
  it('Dado la caja del día anterior cerrada y hoy abierta Cuando cargo un cobro con fecha contable de ayer Entonces queda asignado a hoy con motivo fecha_ya_cerrada conservando su fecha original', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const hoy = diaContableHoy();
    const ayer = restarDias(hoy, 1);
    db.prepare(
      `INSERT INTO cierre_caja
         (id, fecha, zona_horaria, total_efectivo_centavos, total_tarjeta_centavos,
          total_transferencia_centavos, total_mercadopago_centavos, total_obra_social_centavos,
          anulaciones_cantidad, anulaciones_centavos, actor_usuario_id, cerrado_en, created_at, updated_at)
       VALUES ('cierre-ayer', ?, 'America/Buenos_Aires', 0, 0, 0, 0, 0, 0, 0, 'user-caja', 'x', 'x', 'x')`,
    ).run(ayer);
    const service = servicioCaja(db);

    const resultado = service.registrarCobro({
      montoCentavos: 25000,
      medio: 'efectivo',
      turnoId: 'turno-caja',
      actorUsuarioId: 'user-caja',
      fechaContable: ayer,
    });

    expect(resultado.pago.estado).toBe('cobrado');
    expect(movimientosDePago(db, resultado.pago.id)).toEqual([
      {
        tipo: 'cobro',
        monto_centavos: 25000,
        aplicado_en: hoy,
        motivo_asignacion: 'fecha_ya_cerrada',
      },
    ]);

    // el snapshot de AYER no se altera (0) y el resumen de HOY sí lo cuenta
    const cierreAyer = service.historialCierres().find((c) => c.fecha === ayer);
    expect(cierreAyer?.total_efectivo_centavos).toBe(0);
    const resumenHoy = service.resumenPorDia(hoy);
    expect(resumenHoy.por_medio.efectivo).toBe(25000);

    // visible en el listado de movimientos de hoy
    const movimientos = service.movimientosPorFecha(hoy);
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]).toMatchObject({ tipo: 'cobro', aplicado_en: hoy });
    db.close();
  });

  it('Dado todos los días hasta hoy cerrados Cuando cargo un cobro con fecha contable ya cerrada Entonces 409 sin_caja_abierta_asignacion y la transacción se descarta (no persiste el pago)', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const hoy = diaContableHoy();
    const ayer = restarDias(hoy, 1);
    const service = servicioCaja(db);
    // cierra HOY contable (via servicio, con la fecha del reloj) y AYER (fixture)
    service.cerrarCaja({ actorUsuarioId: 'user-caja' });
    db.prepare(
      `INSERT INTO cierre_caja
         (id, fecha, zona_horaria, total_efectivo_centavos, total_tarjeta_centavos,
          total_transferencia_centavos, total_mercadopago_centavos, total_obra_social_centavos,
          anulaciones_cantidad, anulaciones_centavos, actor_usuario_id, cerrado_en, created_at, updated_at)
       VALUES ('cierre-d2', ?, 'America/Buenos_Aires', 0, 0, 0, 0, 0, 0, 0, 'user-caja', 'x', 'x', 'x')`,
    ).run(ayer);

    const err = capturar(() =>
      service.registrarCobro({
        montoCentavos: 25000,
        medio: 'efectivo',
        turnoId: 'turno-caja',
        actorUsuarioId: 'user-caja',
        fechaContable: ayer,
      }),
    );
    expect(err.status).toBe(409);
    expect(err.code).toBe('sin_caja_abierta_asignacion');
    // la transacción de cobro descartada: no quedó ningún pago
    const nPagos = db.prepare('SELECT COUNT(*) AS c FROM pago').get() as { c: number };
    expect(nPagos.c).toBe(0);
    db.close();
  });

  it('Dado una fecha contable en formato invalid Como entrada de cobro Cuando registro Entonces 400 validacion (formato YYYY-MM-DD)', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const service = servicioCaja(db);

    expect(
      capturar(() =>
        service.registrarCobro({
          montoCentavos: 1000,
          medio: 'efectivo',
          turnoId: 'turno-caja',
          actorUsuarioId: 'user-caja',
          fechaContable: '01-06-2026',
        }),
      ).code,
    ).toBe('validacion');
    db.close();
  });
});
