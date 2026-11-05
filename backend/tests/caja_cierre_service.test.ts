/**
 * Tasks 3.5/5.x: servicio de cierre diario de caja (C-11) — escenarios de la
 * spec caja/cierre-diario: snapshot histórico inmutable por fecha contable,
 * totales por medio NETOS de anulaciones del mismo medio, anulaciones aparte,
 * unicidad de cierre, historial y consultas de movimientos con asignación.
 * SQLite REAL en memoria (R12). Datos estrictamente ficticios (R1).
 */
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { PagoRepository } from '../src/core/pago.repository.js';
import {
  CajaMovimientoRepository,
} from '../src/caja/cajaMovimiento.repository.js';
import { CierreCajaRepository } from '../src/caja/cierreCaja.repository.js';
import { CajaError } from '../src/shared/errors.js';
import type { CajaMovimientoId, CierreCajaId, PagoId } from '../src/shared/types.js';
import {
  diaContableHoy,
  seedCajaBase,
  servicioCaja,
} from './helpers/caja-fixtures.js';

function capturar(fn: () => unknown): CajaError {
  try {
    fn();
  } catch (err) {
    if (err instanceof CajaError) return err;
    throw err;
  }
  throw new Error('la operación debería haber fallado con CajaError');
}

function restarDias(dia: string, dias: number): string {
  const anio = Number.parseInt(dia.slice(0, 4), 10);
  const mes = Number.parseInt(dia.slice(5, 7), 10);
  const numeroDia = Number.parseInt(dia.slice(8, 10), 10);
  return new Date(Date.UTC(anio, mes - 1, numeroDia - dias))
    .toISOString()
    .slice(0, 10);
}

/** Semilla: pagos cobrados + sus movimientos (cobros/anulaciones) del día dado. */
function sembrarMovimientos(
  db: ReturnType<typeof openDatabase>,
  lista: { medio: string; monto: number; tipo: 'cobro' | 'anulacion' }[],
  fecha: string,
): void {
  const pagos = new PagoRepository(db);
  const movs = new CajaMovimientoRepository(db);
  lista.forEach((item, i) => {
    const pagoId = `pago-cierre-${i}`;
    pagos.cobrar({
      id: pagoId,
      montoCentavos: item.monto,
      medio: item.medio as never,
      estado: 'cobrado',
      turnoId: 'turno-caja',
      presupuestoId: null,
      actorUsuarioId: 'user-caja',
    });
    movs.insertar({
      id: `mov-cierre-${i}` as CajaMovimientoId,
      pagoId: pagoId as PagoId,
      tipo: item.tipo,
      montoCentavos: item.monto,
      actorUsuarioId: 'user-caja',
      fechaContable: fecha,
    });
  });
}

describe('Cierre diario (spec caja/cierre-diario)', () => {
  it('Dado movimientos del día When cierro la caja Entonces el snapshot calcula netos por medio (tarjeta 800000 − 200000 = 600000) y las anulaciones quedan aparte con cantidad y centavos', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const hoy = diaContableHoy();
    sembrarMovimientos(db, [
      { medio: 'tarjeta', monto: 800000, tipo: 'cobro' },
      { medio: 'efectivo', monto: 50000, tipo: 'cobro' },
      { medio: 'tarjeta', monto: 200000, tipo: 'anulacion' },
      { medio: 'obra_social', monto: 30000, tipo: 'cobro' },
    ], hoy);
    const service = servicioCaja(db);

    const cierre = service.cerrarCaja({ actorUsuarioId: 'user-caja' });

    expect(cierre).toMatchObject({
      fecha: hoy,
      zona_horaria: 'America/Buenos_Aires',
      total_tarjeta_centavos: 600000,
      total_efectivo_centavos: 50000,
      total_transferencia_centavos: 0,
      total_mercadopago_centavos: 0,
      total_obra_social_centavos: 30000,
      anulaciones_cantidad: 1,
      anulaciones_centavos: 200000,
      actor_usuario_id: 'user-caja',
    });
    db.close();
  });

  it('Dado una segunda instrucción de cierre del mismo día contable Cuando cierro Entonces 409 cierre_duplicado; y un movimiento asignado después al día no altera el snapshot ya insertado', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const hoy = diaContableHoy();
    sembrarMovimientos(db, [{ medio: 'efectivo', monto: 100000, tipo: 'cobro' }], hoy);
    const service = servicioCaja(db);
    const cierre = service.cerrarCaja({ actorUsuarioId: 'user-caja' });

    expect(
      capturar(() => service.cerrarCaja({ actorUsuarioId: 'user-caja' })).code,
    ).toBe('cierre_duplicado');

    // movimiento posterior asignado al día recién cerrado (fixture directo):
    // el snapshot histórico NO cambia (tabla insert-only + snapshot ya cerrado)
    const pagos = new PagoRepository(db);
    pagos.cobrar({
      id: 'pago-post',
      montoCentavos: 7000,
      medio: 'efectivo',
      estado: 'cobrado',
      turnoId: 'turno-caja',
      presupuestoId: null,
      actorUsuarioId: 'user-caja',
    });
    new CajaMovimientoRepository(db).insertar({
      id: 'mov-post' as CajaMovimientoId,
      pagoId: 'pago-post' as PagoId,
      tipo: 'cobro',
      montoCentavos: 7000,
      actorUsuarioId: 'user-caja',
      fechaContable: hoy,
    });
    const reintento = capturar(() => service.cerrarCaja({ actorUsuarioId: 'user-caja' }));
    expect(reintento.code).toBe('cierre_duplicado');

    const leerCierre = new CierreCajaRepository(db).buscarPorFecha(hoy);
    expect(leerCierre?.total_efectivo_centavos).toBe(100000); // sin los 7000 posteriores
    db.close();
  });

  it('Dado la caja del día anterior cerrada y hoy abierta Cuando anulo un pago hoy Entonces el movimiento de anulacion queda asignado a hoy (la caja de ayer no cambia)', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const hoy = diaContableHoy();
    const ayer = restarDias(hoy, 1);
    sembrarMovimientos(db, [{ medio: 'efectivo', monto: 60000, tipo: 'cobro' }], ayer);
    // cierro ayer con el snapshot correcto (fixture perfecto del día anterior)
    new CierreCajaRepository(db).insertar({
      id: 'cierre-ayer' as CierreCajaId,
      fecha: ayer,
      zonaHoraria: 'America/Buenos_Aires',
      totalEfectivoCentavos: 60000,
      totalTarjetaCentavos: 0,
      totalTransferenciaCentavos: 0,
      totalMercadopagoCentavos: 0,
      totalObraSocialCentavos: 0,
      anulacionesCantidad: 0,
      anulacionesCentavos: 0,
      actorUsuarioId: 'user-caja',
      cerradoEn: '2026-06-30T23:59:00.000Z',
    });
    const service = servicioCaja(db);

    const cobroHoy = service.registrarCobro({
      montoCentavos: 40000,
      medio: 'transferencia',
      turnoId: 'turno-caja',
      actorUsuarioId: 'user-caja',
    });
    service.anularPago({
      pagoId: cobroHoy.pago.id,
      actorUsuarioId: 'user-caja',
      motivo: 'anulación de prueba ficticia',
    });

    const resumenHoy = service.resumenPorDia(hoy);
    expect(resumenHoy.por_medio.transferencia).toBe(0); // neto: 40000 − 40000
    expect(resumenHoy.anulaciones.cantidad).toBe(1);
    expect(resumenHoy.anulaciones.centavos).toBe(40000);

    // el snapshot de ayer queda intacto
    const snapshotAyer = service.historialCierres().find((c) => c.fecha === ayer);
    expect(snapshotAyer?.total_efectivo_centavos).toBe(60000);
    expect(snapshotAyer?.anulaciones_cantidad).toBe(0);
    db.close();
  });

  it('Dado la caja de hoy ya cerrada Cuando intento anular un pago Entonces 409 sin_caja_abierta_asignacion y el pago sigue cobrado (transacción descartada)', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const service = servicioCaja(db);
    const cobro = service.registrarCobro({
      montoCentavos: 20000,
      medio: 'efectivo',
      turnoId: 'turno-caja',
      actorUsuarioId: 'user-caja',
    });
    service.cerrarCaja({ actorUsuarioId: 'user-caja' });

    const err = capturar(() =>
      service.anularPago({ pagoId: cobro.pago.id, actorUsuarioId: 'user-caja', motivo: 'x' }),
    );
    expect(err.status).toBe(409);
    expect(err.code).toBe('sin_caja_abierta_asignacion');

    const pago = new PagoRepository(db).findById(cobro.pago.id);
    expect(pago?.estado).toBe('cobrado'); // la anulación no se aplicó
    db.close();
  });

  it('Dado varios cierres en orden no cronológico Cuando pido el historial Entonces los devuelve del más reciente al más antiguo', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const hoy = diaContableHoy();
    const repoCierres = new CierreCajaRepository(db);
    repoCierres.insertar({
      id: 'cierre-hace-3' as CierreCajaId,
      fecha: restarDias(hoy, 3),
      zonaHoraria: 'America/Buenos_Aires',
      totalEfectivoCentavos: 0,
      totalTarjetaCentavos: 0,
      totalTransferenciaCentavos: 0,
      totalMercadopagoCentavos: 0,
      totalObraSocialCentavos: 0,
      anulacionesCantidad: 0,
      anulacionesCentavos: 0,
      actorUsuarioId: 'user-caja',
      cerradoEn: '2026-06-27T23:59:00.000Z',
    });
    repoCierres.insertar({
      id: 'cierre-hace-2' as CierreCajaId,
      fecha: restarDias(hoy, 2),
      zonaHoraria: 'America/Buenos_Aires',
      totalEfectivoCentavos: 0,
      totalTarjetaCentavos: 0,
      totalTransferenciaCentavos: 0,
      totalMercadopagoCentavos: 0,
      totalObraSocialCentavos: 0,
      anulacionesCantidad: 0,
      anulacionesCentavos: 0,
      actorUsuarioId: 'user-caja',
      cerradoEn: '2026-06-28T23:59:00.000Z',
    });
    const service = servicioCaja(db);
    service.cerrarCaja({ actorUsuarioId: 'user-caja' }); // cierra hoy

    const fechas = service.historialCierres().map((c) => c.fecha);
    expect(fechas).toEqual([hoy, restarDias(hoy, 2), restarDias(hoy, 3)]);
    db.close();
  });

  it('Dado un día sin cierres y sin movimientos Cuando consulto resumen Entonces devuelve ceros para los cinco medios; con fecha mal formada → 400 validacion', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const service = servicioCaja(db);

    const vacio = service.resumenPorDia(diaContableHoy());
    expect(vacio).toEqual({
      fecha: diaContableHoy(),
      por_medio: {
        efectivo: 0,
        tarjeta: 0,
        transferencia: 0,
        mercadopago: 0,
        obra_social: 0,
      },
      cobrado_ars: 0,
      cobrado_obra_social: 0,
      anulaciones: { cantidad: 0, centavos: 0 },
    });

    expect(capturar(() => service.resumenPorDia('31-12-2026')).code).toBe('validacion');
    expect(capturar(() => service.movimientosPorFecha('31-12-2026')).code).toBe('validacion');
    db.close();
  });

  it('Dado movimientos asignados a una fecha When consulto movimientos Entonces devuelve la vista con pago, tipo, montos y trazabilidad de asignación', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const hoy = diaContableHoy();
    const ayer = restarDias(hoy, 1);
    new CierreCajaRepository(db).insertar({
      id: 'cierre-ayer-mv' as CierreCajaId,
      fecha: ayer,
      zonaHoraria: 'America/Buenos_Aires',
      totalEfectivoCentavos: 0,
      totalTarjetaCentavos: 0,
      totalTransferenciaCentavos: 0,
      totalMercadopagoCentavos: 0,
      totalObraSocialCentavos: 0,
      anulacionesCantidad: 0,
      anulacionesCentavos: 0,
      actorUsuarioId: 'user-caja',
      cerradoEn: '2026-06-30T23:59:00.000Z',
    });
    const service = servicioCaja(db);
    const cobro = service.registrarCobro({
      montoCentavos: 45000,
      medio: 'efectivo',
      turnoId: 'turno-caja',
      actorUsuarioId: 'user-caja',
      fechaContable: ayer,
    });
    expect(cobro.pago.estado).toBe('cobrado');

    const movimientos = service.movimientosPorFecha(hoy);
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]).toMatchObject({
      tipo: 'cobro',
      monto_centavos: 45000,
      moneda: 'ARS',
      fecha_contable: ayer,
      aplicado_en: hoy,
      motivo_asignacion: 'fecha_ya_cerrada',
      actor_usuario_id: 'user-caja',
    });
    expect(service.movimientosPorFecha(ayer)).toEqual([]); // asignado a hoy, no a ayer
    db.close();
  });
});
