/**
 * Tasks 2.2/2.3: repositorio de movimientos de caja (C-11).
 * SQLite REAL en memoria (R12). Verifica: inserción con sello de asignación
 * (`aplicado_en` default = `fecha_contable`), consulta por fecha aplicada y
 * rango, agregados por medio (cobros y anulaciones separados), defensas
 * append-only (EventoInmutableError en repo + trigger en base) y FK a pago.
 */
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import type { DatabaseSync } from 'node:sqlite';
import { PagoRepository } from '../src/core/pago.repository.js';
import {
  CajaMovimientoRepository,
  type CajaMovimientoRow,
} from '../src/caja/cajaMovimiento.repository.js';
import type { CajaMovimientoId, MotivoAsignacionCaja, PagoId } from '../src/shared/types.js';
import { seedCajaBase } from './helpers/caja-fixtures.js';

function insertarMovimiento(
  repo: CajaMovimientoRepository,
  args: {
    id: string;
    pagoId: string;
    tipo: 'cobro' | 'anulacion';
    monto: number;
    fecha: string;
    aplicado?: string;
    motivo?: MotivoAsignacionCaja;
    actor?: string;
  },
): void {
  repo.insertar({
    id: args.id as CajaMovimientoId,
    pagoId: args.pagoId as PagoId,
    tipo: args.tipo,
    montoCentavos: args.monto,
    actorUsuarioId: args.actor ?? 'user-caja',
    fechaContable: args.fecha,
    aplicadoEn: args.aplicado,
    motivoAsignacion: args.motivo ?? undefined,
  });
}

/** Crea un pago cobrado real (FK de movimiento_caja) con el medio indicado. */
function pagoConfirmado(db: DatabaseSync, id: string, medio: string, monto: number): void {
  new PagoRepository(db).cobrar({
    id,
    montoCentavos: monto,
    medio: medio as never,
    estado: 'cobrado',
    turnoId: 'turno-caja',
    presupuestoId: null,
    actorUsuarioId: 'user-caja',
  });
}

describe('CajaMovimientoRepository — asignación y append-only (C-11)', () => {
  it('Dado un movimiento sin asignación explícita Cuando lo inserto Entonces aplicado_en = fecha_contable y motivo NULL; con asignación Entonces conserva fecha original y motivo fecha_ya_cerrada', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    pagoConfirmado(db, 'pago-mv-1', 'tarjeta', 50000);
    const repo = new CajaMovimientoRepository(db);

    insertarMovimiento(repo, { id: 'mov-mv-1', pagoId: 'pago-mv-1', tipo: 'cobro', monto: 50000, fecha: '2026-06-01' });
    insertarMovimiento(repo, {
      id: 'mov-mv-2',
      pagoId: 'pago-mv-1',
      tipo: 'cobro',
      monto: 20000,
      fecha: '2026-06-01',
      aplicado: '2026-06-02',
      motivo: 'fecha_ya_cerrada',
    });

    const filas = repo.listarPorPago('pago-mv-1') as CajaMovimientoRow[];
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({
      fecha_contable: '2026-06-01',
      aplicado_en: '2026-06-01',
      motivo_asignacion: null,
      moneda: 'ARS',
    });
    expect(filas[1]).toMatchObject({
      fecha_contable: '2026-06-01',
      aplicado_en: '2026-06-02',
      motivo_asignacion: 'fecha_ya_cerrada',
    });
    db.close();
  });

  it('Dado movimientos en distintas fechas de asignación Cuando consulto por fecha y por rango Entonces solo los asignados a esa fecha (o dentro del rango) aparecen', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    pagoConfirmado(db, 'pago-mv-range', 'efectivo', 10000);
    const repo = new CajaMovimientoRepository(db);

    insertarMovimiento(repo, { id: 'mov-r-hoy', pagoId: 'pago-mv-range', tipo: 'cobro', monto: 10000, fecha: '2026-06-01' });
    insertarMovimiento(repo, { id: 'mov-r-m', pagoId: 'pago-mv-range', tipo: 'cobro', monto: 20000, fecha: '2026-06-01', aplicado: '2026-06-03', motivo: 'fecha_ya_cerrada' });

    expect(repo.listarPorFechaAplicada('2026-06-01').map((m) => m.id)).toEqual(['mov-r-hoy']);
    expect(repo.listarPorFechaAplicada('2026-06-02')).toEqual([]);
    expect(
      repo.listarPorRangoAplicado('2026-06-02', '2026-06-03').map((m) => m.id),
    ).toEqual(['mov-r-m']);
    db.close();
  });

  it('Dado cobros y anulaciones de varios medios asignados a una fecha Cuando calculo los totales por medio Entonces cada medio agrupa por pago.medio con SUM exactos y separados', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    pagoConfirmado(db, 'pago-tj', 'tarjeta', 800000);
    pagoConfirmado(db, 'pago-ef', 'efectivo', 100000);
    pagoConfirmado(db, 'pago-an', 'tarjeta', 200000);
    const repo = new CajaMovimientoRepository(db);

    insertarMovimiento(repo, { id: 'mov-tj', pagoId: 'pago-tj', tipo: 'cobro', monto: 800000, fecha: '2026-06-05' });
    insertarMovimiento(repo, { id: 'mov-ef', pagoId: 'pago-ef', tipo: 'cobro', monto: 100000, fecha: '2026-06-05' });
    insertarMovimiento(repo, { id: 'mov-an', pagoId: 'pago-an', tipo: 'anulacion', monto: 200000, fecha: '2026-06-05' });

    expect(repo.totalesCobroPorMedio('2026-06-05')).toEqual([
      { medio: 'efectivo', total: 100000 },
      { medio: 'tarjeta', total: 800000 },
    ]);
    expect(repo.totalesAnulacionPorMedio('2026-06-05')).toEqual([
      { medio: 'tarjeta', total: 200000 },
    ]);
    expect(repo.totalesCobroPorMedio('2026-06-06')).toEqual([]);
    db.close();
  });

  it('Dado el repositorio append-only Cuando intento update o softDelete de un movimiento Entonces lanza EventoInmutableError (defensa en código)', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    pagoConfirmado(db, 'pago-mv-inm', 'transferencia', 45000);
    const repo = new CajaMovimientoRepository(db);
    insertarMovimiento(repo, { id: 'mov-inm', pagoId: 'pago-mv-inm', tipo: 'cobro', monto: 45000, fecha: '2026-06-07' });

    expect(() => repo.update('mov-inm', {} as never)).toThrow(/insert-only/);
    expect(() => repo.softDelete('mov-inm')).toThrow(/insert-only/);
    db.close();
  });

  it('Dado triggers insert-only de la migración Cuando ejecuto UPDATE o DELETE directos Entonces SQLite aborta la operación (defensa en base, R8/R12)', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    pagoConfirmado(db, 'pago-mv-trig', 'tarjeta', 30000);
    const repo = new CajaMovimientoRepository(db);
    insertarMovimiento(repo, { id: 'mov-trig', pagoId: 'pago-mv-trig', tipo: 'cobro', monto: 30000, fecha: '2026-06-08' });

    expect(() =>
      db.prepare(`UPDATE movimiento_caja SET monto_centavos = 1 WHERE id = 'mov-trig'`).run(),
    ).toThrow();
    expect(() =>
      db.prepare(`DELETE FROM movimiento_caja WHERE id = 'mov-trig'`).run(),
    ).toThrow();
    // la fila quedó intacta tras los intentos abortados
    expect(repo.listarPorPago('pago-mv-trig')).toHaveLength(1);
    db.close();
  });

  it('Dado un movimiento cargado con monto negativo o tipo inválido Cuando inserto Entonces el repositorio lo rechaza antes de tocar la base', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    pagoConfirmado(db, 'pago-mv-val', 'efectivo', 15000);
    const repo = new CajaMovimientoRepository(db);

    expect(() =>
      insertarMovimiento(repo, { id: 'mov-neg', pagoId: 'pago-mv-val', tipo: 'cobro', monto: -1, fecha: '2026-06-09' }),
    ).toThrow();
    expect(() =>
      repo.insertar({
        id: 'mov-tipo' as CajaMovimientoId,
        pagoId: 'pago-mv-val' as PagoId,
        tipo: 'ajuste' as never,
        montoCentavos: 1000,
        actorUsuarioId: 'user-caja',
        fechaContable: '2026-06-09',
      }),
    ).toThrow();
    db.close();
  });
});
