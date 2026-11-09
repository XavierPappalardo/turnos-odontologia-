/**
 * C-14 tasks 3.1/3.3 y 6.1/6.3 — agregados y servicio de FACTURACIÓN.
 *
 * Primera mitad: escenarios de repositorio (grupo 3). Segunda mitad: escenarios
 * del servicio de facturación (grupo 6), incluida la conciliación con el
 * `cierre_caja`. SQLite REAL en memoria (R12), fixtures ficticios (R1).
 * Verifica: agrupación por `aplicado_en` (no por `fecha_contable`), `JOIN pago`
 * para el medio, neteo de anulaciones, los cinco medios siempre presentes y
 * montos enteros en centavos sin pérdida de precisión (R2/R5).
 *
 * Unidades: `cobros`, `anulaciones` y sus cantidades están en centavos
 * enteros / unidades; nunca float (R2/R5).
 */
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { ReportesRepository } from '../src/reportes/reportes.repository.js';
import { crearServicioFacturacion } from '../src/reportes/facturacion.service.js';
import { ErrorPeriodoInvalido } from '../src/reportes/periodo.js';
import { CajaService } from '../src/caja/caja.service.js';
import { CierreCajaRepository } from '../src/caja/cierreCaja.repository.js';
import type { PagoMedio } from '../src/core/models.js';
import type { CierreCajaId } from '../src/shared/types.js';
import {
  seedReportesBase,
  sembrarMovimiento,
  sembrarPago,
  ZONA_TEST,
} from './helpers/reportes-fixtures.js';

const RANGO = { desde: '2026-11-01', hasta: '2026-11-07' } as const;

function nuevoRepo() {
  const db = openDatabase(':memory:');
  seedReportesBase(db);
  return { db, repo: new ReportesRepository(db) };
}

/**
 * Alta conjunta pago + movimiento: un pago puede acumular cobro y anulación,
 * pero para escenarios simples se crea un pago por movimiento.
 */
function movimiento(
  db: ReturnType<typeof openDatabase>,
  args: {
    clave: string;
    medio:
      | 'efectivo'
      | 'tarjeta'
      | 'transferencia'
      | 'mercadopago'
      | 'obra_social';
    tipo: 'cobro' | 'anulacion';
    monto: number;
    fechaContable: string;
    aplicadoEn?: string;
  },
): void {
  const pagoId = `pago-${args.clave}`;
  sembrarPago(db, {
    id: pagoId,
    montoCentavos: args.monto,
    medio: args.medio,
  });
  sembrarMovimiento(db, {
    id: `mov-${args.clave}`,
    pagoId,
    tipo: args.tipo,
    montoCentavos: args.monto,
    fechaContable: args.fechaContable,
    aplicadoEn: args.aplicadoEn,
    motivoAsignacion:
      args.aplicadoEn !== undefined && args.aplicadoEn !== args.fechaContable
        ? 'fecha_ya_cerrada'
        : undefined,
  });
}

describe('ReportesRepository — facturación por aplicado_en (task 3.1)', () => {
  it('Dado cobros y una anulación del mismo día Cuando consulto ingresosPorAplicadoEn Entonces agrupa por aplicado_en y medio con cobros, anulaciones y cantidades', () => {
    const { db, repo } = nuevoRepo();
    movimiento(db, {
      clave: 'ef-1',
      medio: 'efectivo',
      tipo: 'cobro',
      monto: 50000,
      fechaContable: '2026-11-03',
    });
    movimiento(db, {
      clave: 'tj-1',
      medio: 'tarjeta',
      tipo: 'cobro',
      monto: 20000,
      fechaContable: '2026-11-03',
    });
    movimiento(db, {
      clave: 'tj-2',
      medio: 'tarjeta',
      tipo: 'anulacion',
      monto: 5000,
      fechaContable: '2026-11-03',
    });

    const filas = repo.ingresosPorAplicadoEn(RANGO.desde, RANGO.hasta);

    expect(filas).toEqual([
      {
        aplicado_en: '2026-11-03',
        medio: 'efectivo',
        cobros: 50000,
        anulaciones: 0,
        cobros_cantidad: 1,
        anulaciones_cantidad: 0,
      },
      {
        aplicado_en: '2026-11-03',
        medio: 'tarjeta',
        cobros: 20000,
        anulaciones: 5000,
        cobros_cantidad: 1,
        anulaciones_cantidad: 1,
      },
    ]);
  });

  it('Dado un movimiento cuya fecha_contable difiere de aplicado_en Cuando consulto el rango Entonces se agrupa por aplicado_en', () => {
    const { db, repo } = nuevoRepo();
    movimiento(db, {
      clave: 'asignado',
      medio: 'transferencia',
      tipo: 'cobro',
      monto: 30000,
      fechaContable: '2026-11-03',
      aplicadoEn: '2026-11-04',
    });

    const filas = repo.ingresosPorAplicadoEn('2026-11-03', '2026-11-04');

    expect(filas).toHaveLength(1);
    expect(filas[0]?.aplicado_en).toBe('2026-11-04');
    expect(filas[0]?.cobros).toBe(30000);
  });

  it('Dado movimientos fuera del rango Cuando consulto Entonces devuelve un array vacío', () => {
    const { db, repo } = nuevoRepo();
    movimiento(db, {
      clave: 'fuera',
      medio: 'efectivo',
      tipo: 'cobro',
      monto: 10000,
      fechaContable: '2026-11-20',
    });

    expect(repo.ingresosPorAplicadoEn(RANGO.desde, RANGO.hasta)).toEqual([]);
  });
});

describe('ReportesRepository — filtro y cobertura de medios (task 3.3)', () => {
  it('Dado un cobro con motivo fecha_ya_cerrada Cuando filtro por el día aplicado Entonces sólo aparece en ese día', () => {
    const { db, repo } = nuevoRepo();
    movimiento(db, {
      clave: 'cerrada',
      medio: 'obra_social',
      tipo: 'cobro',
      monto: 90000,
      fechaContable: '2026-11-03',
      aplicadoEn: '2026-11-05',
    });

    expect(repo.ingresosPorAplicadoEn('2026-11-03', '2026-11-03')).toEqual([]);
    const filas = repo.ingresosPorAplicadoEn('2026-11-05', '2026-11-05');
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      aplicado_en: '2026-11-05',
      medio: 'obra_social',
      cobros: 90000,
    });
  });

  it('Dado un cobro sin anulación Cuando consulto Entonces anulaciones y su cantidad son 0', () => {
    const { db, repo } = nuevoRepo();
    movimiento(db, {
      clave: 'solo-cobro',
      medio: 'mercadopago',
      tipo: 'cobro',
      monto: 7000,
      fechaContable: '2026-11-02',
    });

    const [fila] = repo.ingresosPorAplicadoEn(RANGO.desde, RANGO.hasta);

    expect(fila).toEqual({
      aplicado_en: '2026-11-02',
      medio: 'mercadopago',
      cobros: 7000,
      anulaciones: 0,
      cobros_cantidad: 1,
      anulaciones_cantidad: 0,
    });
  });

  it('Dado una anulación sin cobro previo en el rango Cuando consulto Entonces la anulación se informa aparte', () => {
    const { db, repo } = nuevoRepo();
    movimiento(db, {
      clave: 'anulacion-suelta',
      medio: 'tarjeta',
      tipo: 'anulacion',
      monto: 15000,
      fechaContable: '2026-11-06',
    });

    const [fila] = repo.ingresosPorAplicadoEn(RANGO.desde, RANGO.hasta);

    expect(fila).toEqual({
      aplicado_en: '2026-11-06',
      medio: 'tarjeta',
      cobros: 0,
      anulaciones: 15000,
      cobros_cantidad: 0,
      anulaciones_cantidad: 1,
    });
  });

  it('Dado movimientos de los cinco medios Cuando filtro por medio Entonces sólo devuelve ese medio', () => {
    const { db, repo } = nuevoRepo();
    const medios = [
      'efectivo',
      'tarjeta',
      'transferencia',
      'mercadopago',
      'obra_social',
    ] as const;
    medios.forEach((medio, indice) => {
      movimiento(db, {
        clave: `medio-${indice}`,
        medio,
        tipo: 'cobro',
        monto: 1000 * (indice + 1),
        fechaContable: '2026-11-04',
      });
    });

    expect(repo.ingresosPorAplicadoEn(RANGO.desde, RANGO.hasta)).toHaveLength(5);
    const filas = repo.ingresosPorAplicadoEn(
      RANGO.desde,
      RANGO.hasta,
      'obra_social',
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]?.medio).toBe('obra_social');
  });
});

/* ── Servicio de facturación (tasks 6.1/6.3) ── */

function nuevoServicio() {
  const db = openDatabase(':memory:');
  seedReportesBase(db);
  const repo = new ReportesRepository(db);
  const servicio = crearServicioFacturacion({
    repo,
    zonaHoraria: ZONA_TEST,
  });
  return { db, repo, servicio };
}

describe('facturacion.service — neto y desglose por medio (task 6.1)', () => {
  it('Dado un cobro de 50000 y una anulación de 20000 Cuando calculo Entonces el neto es 30000 con sus cantidades', () => {
    const { db, servicio } = nuevoServicio();
    movimiento(db, {
      clave: 'neto-cobro',
      medio: 'efectivo',
      tipo: 'cobro',
      monto: 50000,
      fechaContable: '2026-11-03',
    });
    movimiento(db, {
      clave: 'neto-anulacion',
      medio: 'efectivo',
      tipo: 'anulacion',
      monto: 20000,
      fechaContable: '2026-11-03',
    });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'dia' });

    expect(reporte.total).toEqual({
      cobros: { cantidad: 1, centavos: 50000 },
      anulaciones: { cantidad: 1, centavos: 20000 },
      ingresos_netos_centavos: 30000,
      bolsillo_centavos: 30000,
      obra_social_centavos: 0,
    });
    expect(reporte.series).toEqual([
      { clave: '2026-11-03', ingresos_netos_centavos: 30000 },
    ]);
  });

  it('Dado movimientos de efectivo, tarjeta y obra social con anulación de tarjeta Cuando calculo Entonces por_medio devuelve los cinco medios neteados', () => {
    const { db, servicio } = nuevoServicio();
    movimiento(db, {
      clave: 'medio-efectivo',
      medio: 'efectivo',
      tipo: 'cobro',
      monto: 10000,
      fechaContable: '2026-11-03',
    });
    movimiento(db, {
      clave: 'medio-tarjeta-cobro',
      medio: 'tarjeta',
      tipo: 'cobro',
      monto: 20000,
      fechaContable: '2026-11-03',
    });
    movimiento(db, {
      clave: 'medio-tarjeta-anulacion',
      medio: 'tarjeta',
      tipo: 'anulacion',
      monto: 5000,
      fechaContable: '2026-11-03',
    });
    movimiento(db, {
      clave: 'medio-os',
      medio: 'obra_social',
      tipo: 'cobro',
      monto: 15000,
      fechaContable: '2026-11-03',
    });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'dia' });

    expect(reporte.por_medio).toEqual({
      efectivo: 10000,
      tarjeta: 15000,
      transferencia: 0,
      mercadopago: 0,
      obra_social: 15000,
    });
    expect(reporte.total.bolsillo_centavos).toBe(25000);
    expect(reporte.total.obra_social_centavos).toBe(15000);
    expect(
      reporte.total.bolsillo_centavos + reporte.total.obra_social_centavos,
    ).toBe(reporte.total.ingresos_netos_centavos);
    expect(reporte.total.ingresos_netos_centavos).toBe(40000);
  });

  it('Dado un rango sin movimientos Cuando calculo Entonces los totales son cero y por_medio trae los cinco medios en 0', () => {
    const { servicio } = nuevoServicio();

    const reporte = servicio.calcular({
      desde: '2030-01-01',
      hasta: '2030-01-07',
      granularidad: 'dia',
    });

    expect(reporte.total).toEqual({
      cobros: { cantidad: 0, centavos: 0 },
      anulaciones: { cantidad: 0, centavos: 0 },
      ingresos_netos_centavos: 0,
      bolsillo_centavos: 0,
      obra_social_centavos: 0,
    });
    expect(reporte.por_medio).toEqual({
      efectivo: 0,
      tarjeta: 0,
      transferencia: 0,
      mercadopago: 0,
      obra_social: 0,
    });
    expect(reporte.series).toEqual([]);
  });

  it('Dado un filtro por medio Cuando calculo Entonces total, por_medio y series sólo contabilizan ese medio', () => {
    const { db, servicio } = nuevoServicio();
    movimiento(db, {
      clave: 'filtro-efectivo',
      medio: 'efectivo',
      tipo: 'cobro',
      monto: 10000,
      fechaContable: '2026-11-03',
    });
    movimiento(db, {
      clave: 'filtro-os',
      medio: 'obra_social',
      tipo: 'cobro',
      monto: 15000,
      fechaContable: '2026-11-04',
    });

    const reporte = servicio.calcular({
      ...RANGO,
      granularidad: 'dia',
      medio: 'obra_social',
    });

    expect(reporte.total.ingresos_netos_centavos).toBe(15000);
    expect(reporte.total.cobros).toEqual({ cantidad: 1, centavos: 15000 });
    expect(reporte.por_medio).toEqual({
      efectivo: 0,
      tarjeta: 0,
      transferencia: 0,
      mercadopago: 0,
      obra_social: 15000,
    });
    expect(reporte.series).toEqual([
      { clave: '2026-11-04', ingresos_netos_centavos: 15000 },
    ]);
  });

  it('Dado un medio fuera del catálogo Cuando calculo Entonces rechaza con ErrorPeriodoInvalido de campo medio', () => {
    const { servicio } = nuevoServicio();

    const ejecutar = (): unknown =>
      servicio.calcular({
        ...RANGO,
        granularidad: 'dia',
        medio: 'cheque' as unknown as PagoMedio,
      });

    expect(ejecutar).toThrow(ErrorPeriodoInvalido);
    try {
      ejecutar();
    } catch (err) {
      expect(err).toBeInstanceOf(ErrorPeriodoInvalido);
      expect((err as ErrorPeriodoInvalido).campo).toBe('medio');
    }
  });

  it('Dado cualquier consulta Cuando calculo Entonces la respuesta incluye rango, granularidad y zona horaria', () => {
    const { servicio } = nuevoServicio();

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'mes' });

    expect(reporte).toMatchObject({
      desde: '2026-11-01',
      hasta: '2026-11-07',
      granularidad: 'mes',
      zona_horaria: ZONA_TEST,
    });
  });
});

describe('facturacion.service — series por granularidad (task 6.1)', () => {
  it('Dado movimientos en dos días Cuando calculo granularidad dia Entonces cada día lleva su neto', () => {
    const { db, servicio } = nuevoServicio();
    movimiento(db, {
      clave: 'serie-dia-1',
      medio: 'efectivo',
      tipo: 'cobro',
      monto: 10000,
      fechaContable: '2026-11-02',
    });
    movimiento(db, {
      clave: 'serie-dia-2',
      medio: 'tarjeta',
      tipo: 'cobro',
      monto: 25000,
      fechaContable: '2026-11-04',
    });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'dia' });

    expect(reporte.series).toEqual([
      { clave: '2026-11-02', ingresos_netos_centavos: 10000 },
      { clave: '2026-11-04', ingresos_netos_centavos: 25000 },
    ]);
  });

  it('Dado el 2026-11-02 (lunes) y el 2026-11-04 Cuando calculo granularidad semana Entonces ambos caen en 2026-W45', () => {
    const { db, servicio } = nuevoServicio();
    movimiento(db, {
      clave: 'serie-semana-1',
      medio: 'efectivo',
      tipo: 'cobro',
      monto: 10000,
      fechaContable: '2026-11-02',
    });
    movimiento(db, {
      clave: 'serie-semana-2',
      medio: 'efectivo',
      tipo: 'cobro',
      monto: 5000,
      fechaContable: '2026-11-04',
    });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'semana' });

    expect(reporte.series).toEqual([
      { clave: '2026-W45', ingresos_netos_centavos: 15000 },
    ]);
  });

  it('Dado movimientos en distintos días de noviembre Cuando calculo granularidad mes Entonces hay una única clave 2026-11 con el neto', () => {
    const { db, servicio } = nuevoServicio();
    movimiento(db, {
      clave: 'serie-mes-1',
      medio: 'efectivo',
      tipo: 'cobro',
      monto: 10000,
      fechaContable: '2026-11-02',
    });
    movimiento(db, {
      clave: 'serie-mes-2',
      medio: 'obra_social',
      tipo: 'cobro',
      monto: 20000,
      fechaContable: '2026-11-20',
    });

    const reporte = servicio.calcular({
      desde: '2026-11-01',
      hasta: '2026-11-30',
      granularidad: 'mes',
    });

    expect(reporte.series).toEqual([
      { clave: '2026-11', ingresos_netos_centavos: 30000 },
    ]);
  });
});

describe('facturacion.service — conciliación y precisión (task 6.3)', () => {
  it('Dado un día cerrado Cuando comparo el reporte con el cierre_caja Entonces el neto por medio coincide exactamente', () => {
    const { db, servicio } = nuevoServicio();
    movimiento(db, {
      clave: 'conc-efectivo',
      medio: 'efectivo',
      tipo: 'cobro',
      monto: 120000,
      fechaContable: '2026-11-03',
    });
    movimiento(db, {
      clave: 'conc-tarjeta',
      medio: 'tarjeta',
      tipo: 'cobro',
      monto: 80000,
      fechaContable: '2026-11-03',
    });
    movimiento(db, {
      clave: 'conc-tarjeta-anulacion',
      medio: 'tarjeta',
      tipo: 'anulacion',
      monto: 20000,
      fechaContable: '2026-11-03',
    });
    movimiento(db, {
      clave: 'conc-os',
      medio: 'obra_social',
      tipo: 'cobro',
      monto: 40000,
      fechaContable: '2026-11-03',
    });

    // Snapshot persistido de la misma fecha: los totales por medio del cierre
    // salen de `CajaService.resumenPorDia`, la fuente autoritativa de caja.
    const resumen = new CajaService(db, {
      zonaHoraria: ZONA_TEST,
    }).resumenPorDia('2026-11-03');
    new CierreCajaRepository(db).insertar({
      id: 'cierre-conciliacion' as CierreCajaId,
      fecha: '2026-11-03',
      zonaHoraria: ZONA_TEST,
      totalEfectivoCentavos: resumen.por_medio.efectivo,
      totalTarjetaCentavos: resumen.por_medio.tarjeta,
      totalTransferenciaCentavos: resumen.por_medio.transferencia,
      totalMercadopagoCentavos: resumen.por_medio.mercadopago,
      totalObraSocialCentavos: resumen.por_medio.obra_social,
      anulacionesCantidad: resumen.anulaciones.cantidad,
      anulacionesCentavos: resumen.anulaciones.centavos,
      actorUsuarioId: 'user-reportes',
      cerradoEn: '2026-11-03T23:59:00.000Z',
    });
    const cierre = new CierreCajaRepository(db).buscarPorFecha('2026-11-03');

    const reporte = servicio.calcular({
      desde: '2026-11-03',
      hasta: '2026-11-03',
      granularidad: 'dia',
    });

    expect(cierre).toBeDefined();
    expect(reporte.por_medio).toEqual({
      efectivo: cierre?.total_efectivo_centavos,
      tarjeta: cierre?.total_tarjeta_centavos,
      transferencia: cierre?.total_transferencia_centavos,
      mercadopago: cierre?.total_mercadopago_centavos,
      obra_social: cierre?.total_obra_social_centavos,
    });
    expect(reporte.total.ingresos_netos_centavos).toBe(220000);
    expect(reporte.total.anulaciones).toEqual({ cantidad: 1, centavos: 20000 });
  });

  it('Dado cobros que totalizan 9007199254740991 centavos Cuando calculo Entonces el total es exacto (sin float)', () => {
    const { db, servicio } = nuevoServicio();
    movimiento(db, {
      clave: 'prec-1',
      medio: 'efectivo',
      tipo: 'cobro',
      monto: 5000000000000000,
      fechaContable: '2026-11-03',
    });
    movimiento(db, {
      clave: 'prec-2',
      medio: 'transferencia',
      tipo: 'cobro',
      monto: 4007199254740991,
      fechaContable: '2026-11-03',
    });

    const reporte = servicio.calcular({ ...RANGO, granularidad: 'dia' });

    expect(reporte.total.ingresos_netos_centavos).toBe(9007199254740991);
    expect(Number.isSafeInteger(reporte.total.ingresos_netos_centavos)).toBe(
      true,
    );
    expect(reporte.por_medio.efectivo).toBe(5000000000000000);
    expect(reporte.por_medio.transferencia).toBe(4007199254740991);
  });
});

