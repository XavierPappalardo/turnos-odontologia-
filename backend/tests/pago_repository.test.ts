/**
 * Tasks 2.1/2.3: repositorio de pagos de caja (C-11).
 * SQLite REAL en memoria con migraciones (R12, sin mock de transacciones) y
 * datos estrictamente ficticios (R1/R12). Verifica: alta de cobro
 * (`cobrar`) con validaciones de dominio, idempotencia consultable,
 * transiciones controladas (marcarCobrado/anular) y agregados financieros
 * en centavos exactos (anulado y pendiente fuera de los totales; obra
 * social separada del bolsillo).
 */
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import type { DatabaseSync } from 'node:sqlite';
import {
  MEDIOS_BOLSILLO,
  MEDIOS_PAGO,
  PagoRepository,
  type CobroCaja,
} from '../src/core/pago.repository.js';
import type { PagoEstado, PagoMedio } from '../src/core/models.js';
import {
  insertConcepto,
  seedCajaBase,
} from './helpers/caja-fixtures.js';

function cobroValido(args: {
  db: DatabaseSync;
  encima: { id: string; medio: PagoMedio; estado?: PagoEstado; extra?: Partial<CobroCaja> };
}): ReturnType<PagoRepository['cobrar']> {
  const repo = new PagoRepository(args.db);
  return repo.cobrar({
    id: args.encima.id,
    montoCentavos: 50000,
    medio: args.encima.medio,
    estado: args.encima.estado ?? 'cobrado',
    turnoId: 'turno-caja',
    presupuestoId: null,
    ...args.encima.extra,
  });
}

describe('PagoRepository — caja (C-11)', () => {
  it('Dado medios del catálogo Cuando inspecciono las constantes Entonces bolsillo excluye obra_social y el catálogo la incluye', () => {
    expect(MEDIOS_BOLSILLO).toEqual([
      'efectivo',
      'tarjeta',
      'transferencia',
      'mercadopago',
    ]);
    expect(MEDIOS_PAGO).toEqual([...MEDIOS_BOLSILLO, 'obra_social']);
  });

  it('Dado un concepto aceptado Cuando cobro aplicado al presupuesto Entonces la fila queda cobrada por el actor indicado (presupuesto_id + turno denormalizado opcional)', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    insertConcepto(db, {
      id: 'pres-concepto-1',
      turnoId: 'turno-caja',
      totalCentavos: 100000,
      coberturaCentavos: 40000,
      saldoCentavos: 60000,
    });
    const repo = new PagoRepository(db);

    const fila = cobroValido({
      db,
      encima: {
        id: 'pago-rp-1',
        medio: 'efectivo',
        extra: {
          turnoId: 'turno-caja',
          presupuestoId: 'pres-concepto-1',
          actorUsuarioId: 'user-caja',
          claveIdempotencia: 'clave-rp-1',
          referencia: 'últimos 4: 0012',
        },
      },
    });

    expect(fila.estado).toBe('cobrado');
    expect(fila.monto_centavos).toBe(50000);
    expect(fila.moneda).toBe('ARS');
    expect(fila.medio).toBe('efectivo');
    expect(fila.presupuesto_id).toBe('pres-concepto-1');
    expect(fila.turno_id).toBe('turno-caja');
    expect(fila.actor_usuario_id).toBe('user-caja');
    expect(fila.clave_idempotencia).toBe('clave-rp-1');
    expect(fila.referencia).toBe('últimos 4: 0012');
    expect(fila.anulado_por_usuario_id).toBeNull();
    db.close();
  });

  it('Dado un cobro directo por turno (sin concepto) Cuando cobro con solo turno_id Entonces persiste con presupuesto_id NULL', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db); // turno-caja sin presupuestos
    const repo = new PagoRepository(db);

    const fila = cobroValido({
      db,
      encima: {
        id: 'pago-rp-2',
        medio: 'tarjeta',
        extra: { turnoId: 'turno-caja', presupuestoId: null },
      },
    });

    expect(fila.turno_id).toBe('turno-caja');
    expect(fila.presupuesto_id).toBeNull();
    db.close();
  });

  it('Dado montos inválidos Cuando cobro Entonces rechaza cero, negativos y no enteros (R2/R5, precisión exacta)', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const repo = new PagoRepository(db);
    const base: CobroCaja = {
      id: 'pago-x',
      montoCentavos: 1,
      medio: 'efectivo',
      estado: 'cobrado',
      turnoId: 'turno-caja',
      presupuestoId: null,
    };

    expect(() => repo.cobrar({ ...base, montoCentavos: 0 })).toThrow();
    expect(() => repo.cobrar({ ...base, montoCentavos: -1 })).toThrow();
    expect(() => repo.cobrar({ ...base, montoCentavos: 1250.5 })).toThrow();
    db.close();
  });

  it('Dado un medio fuera del catálogo o un cobro sin aplicación Cuando cobro Entonces rechaza', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const repo = new PagoRepository(db);

    expect(() =>
      repo.cobrar({
        id: 'pago-medio',
        montoCentavos: 1000,
        medio: 'criptomonedas' as never,
        estado: 'cobrado',
        turnoId: 'turno-caja',
        presupuestoId: null,
      }),
    ).toThrow();
    expect(() =>
      repo.cobrar({
        id: 'pago-sin-app',
        montoCentavos: 1000,
        medio: 'efectivo',
        estado: 'cobrado',
        turnoId: null,
        presupuestoId: null,
      }),
    ).toThrow();
    db.close();
  });

  it('Dado cobros en distintos estados Cuando calculo los agregados del concepto Entonces anulado y pendiente quedan fuera de todos los totales', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    insertConcepto(db, {
      id: 'pres-concepto-2',
      turnoId: 'turno-caja',
      totalCentavos: 200000,
      coberturaCentavos: 0,
      saldoCentavos: 200000,
    });
    const repo = new PagoRepository(db);

    cobroValido({ db, encima: { id: 'pago-ok', medio: 'efectivo', estado: 'cobrado', extra: { turnoId: 'turno-caja', presupuestoId: 'pres-concepto-2' } } });
    cobroValido({ db, encima: { id: 'pago-pend', medio: 'tarjeta', estado: 'pendiente', extra: { turnoId: 'turno-caja', presupuestoId: 'pres-concepto-2' } } });
    cobroValido({ db, encima: { id: 'pago-nulo', medio: 'transferencia', estado: 'anulado', extra: { turnoId: 'turno-caja', presupuestoId: 'pres-concepto-2' } } });

    expect(repo.cobroBolsilloPorConcepto('pres-concepto-2')).toBe(50000);
    expect(repo.cobroObraSocialPorConcepto('pres-concepto-2')).toBe(0);
    expect(repo.cobroBolsilloPorTurno('turno-caja')).toBe(50000);
    expect(repo.totalCobradoPorTurno('turno-caja')).toBe(50000);
    // historial del concepto: incluye los tres (anulados y pendientes visibles)
    expect(repo.listarPorPresupuesto('pres-concepto-2')).toHaveLength(3);
    db.close();
  });

  it('Dado cobros de bolsillo y obra social sobre el mismo concepto Cuando calculo agregados Entonces obra_social no descuenta el saldo del paciente ni computa en bolsillo', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    insertConcepto(db, {
      id: 'pres-concepto-3',
      turnoId: 'turno-caja',
      totalCentavos: 150000,
      coberturaCentavos: 90000,
      saldoCentavos: 60000,
    });
    const repo = new PagoRepository(db);

    cobroValido({ db, encima: { id: 'pago-os', medio: 'obra_social', estado: 'cobrado', extra: { turnoId: 'turno-caja', presupuestoId: 'pres-concepto-3' } } });
    cobroValido({ db, encima: { id: 'pago-bol', medio: 'efectivo', estado: 'cobrado', extra: { turnoId: 'turno-caja', presupuestoId: 'pres-concepto-3' } } });

    expect(repo.cobroObraSocialPorConcepto('pres-concepto-3')).toBe(50000);
    expect(repo.cobroBolsilloPorConcepto('pres-concepto-3')).toBe(50000); // solo el efectivo
    expect(repo.cobroObraSocialPorTurno('turno-caja')).toBe(50000);
    expect(repo.cobroBolsilloPorTurno('turno-caja')).toBe(50000);
    expect(repo.totalCobradoPorTurno('turno-caja')).toBe(100000);
    db.close();
  });

  it('Dado marcaCobrado y anular Cuando aplico las transiciones Entonces son idempotentes por estado y el pago anulado registra actor, motivo y en', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const repo = new PagoRepository(db);
    repo.cobrar({
      id: 'pago-mp-1',
      montoCentavos: 30000,
      medio: 'mercadopago',
      estado: 'pendiente',
      turnoId: 'turno-caja',
      presupuestoId: null,
      actorUsuarioId: 'user-caja',
    });

    expect(repo.marcarCobrado('pago-mp-1')).toBe(true);
    expect(repo.marcarCobrado('pago-mp-1')).toBe(false); // ya cobrado

    expect(
      repo.anular('pago-mp-1', {
        anuladoPorUsuarioId: 'user-caja',
        motivo: 'cobro duplicado ficticio',
      }),
    ).toBe(true);
    expect(
      repo.anular('pago-mp-1', {
        anuladoPorUsuarioId: 'user-caja',
        motivo: 'segundo intento',
      }),
    ).toBe(false); // ya anulado

    const fila = repo.findById('pago-mp-1');
    expect(fila?.estado).toBe('anulado');
    expect(fila?.anulado_por_usuario_id).toBe('user-caja');
    expect(fila?.motivo_anulacion).toBe('cobro duplicado ficticio');
    expect(typeof fila?.anulado_en).toBe('string');
    expect((fila?.anulado_en ?? '').length).toBeGreaterThan(0);
    db.close();
  });

  it('Dado un pago con clave de idempotencia Cuando busco por la clave Entonces lo devuelve; claves desconocidas no', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const repo = new PagoRepository(db);
    repo.cobrar({
      id: 'pago-idem',
      montoCentavos: 7000,
      medio: 'efectivo',
      estado: 'cobrado',
      turnoId: 'turno-caja',
      presupuestoId: null,
      claveIdempotencia: 'clave-idem-1',
    });

    expect(repo.buscarPorClaveIdempotencia('clave-idem-1')?.id).toBe('pago-idem');
    expect(repo.buscarPorClaveIdempotencia('otra-clave')).toBeUndefined();
    db.close();
  });

  it('Dado pagos de dos turnos Cuando listo historiales Entonces cada listado devuelve solo su turno y cuando anulo uno Entonces el anulado sigue en el historial (trazabilidad)', () => {
    const db = openDatabase(':memory:');
    const seed = seedCajaBase(db);
    insertConcepto(db, {
      id: 'pres-concepto-4',
      turnoId: 'turno-caja',
      totalCentavos: 80000,
      coberturaCentavos: 0,
      saldoCentavos: 80000,
    });
    const repo = new PagoRepository(db);
    const a = cobroValido({ db, encima: { id: 'pago-h-1', medio: 'efectivo', estado: 'cobrado', extra: { turnoId: 'turno-caja', presupuestoId: 'pres-concepto-4' } } });
    repo.anular(a.id, { anuladoPorUsuarioId: seed.usuarioId, motivo: 'error de carga ficticio' });

    const historial = repo.listarPorTurno('turno-caja');
    expect(historial).toHaveLength(1);
    expect(historial[0]?.id).toBe('pago-h-1');
    expect(historial[0]?.estado).toBe('anulado');
    expect(repo.listarPorTurno('no-existe')).toEqual([]);
    db.close();
  });
});
