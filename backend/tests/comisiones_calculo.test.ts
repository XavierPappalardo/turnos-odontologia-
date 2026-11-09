/**
 * Task 4.2: motor de cálculo puro de comisiones (C-13).
 * Suite 100% unitaria (sin SQLite): la función pura NO accede ni muta la base
 * (D8/D10) — los efectos laterales se descartan con entradas congeladas.
 * Escenarios Dado/Cuando/Entonces (R11) con datos ficticios (R1/R12) y
 * aritmética entera exacta (R2/R5/R6).
 */
import { describe, expect, it } from 'vitest';
import type { CobroElegibleComisionRow } from '../src/core/pago.repository.js';
import type {
  AnulacionPendienteRow,
  SaldoArrastreRow,
} from '../src/comisiones/liquidacionAjuste.repository.js';
import {
  calcularLiquidacion,
  truncarComision,
  type ConfigGeneralCalculo,
  type ConfigTratamientoCalculo,
  type ResultadoCalculo,
} from '../src/comisiones/calculo.js';

/** Cobro candidato con atribución por defecto: turno `tur-1` (pres-1), elegible. */
function cobro(
  pagoId: string,
  overrides: Partial<CobroElegibleComisionRow> = {},
): CobroElegibleComisionRow {
  return {
    pago_id: pagoId,
    monto_centavos: overrides.monto_centavos ?? 100000,
    medio: overrides.medio ?? 'efectivo',
    turno_id: overrides.turno_id ?? 'tur-1',
    prestacion_id:
      'prestacion_id' in overrides ? (overrides.prestacion_id ?? null) : 'pres-1',
    aplicacion: overrides.aplicacion ?? 'turno',
    fecha_contable: overrides.fecha_contable ?? '2026-11-10',
    motivo_descarte: overrides.motivo_descarte ?? null,
  };
}

/** Config general canónica del profesional `prof-1`. */
function configGeneral(pctGeneral: number): ConfigGeneralCalculo {
  return {
    id: 'cfg-general',
    profesional_id: 'prof-1',
    pct_general: pctGeneral,
    updated_at: '2026-11-01T00:00:00.000Z',
  };
}

/** Config específica vigente del par (profesional, prestación). */
function tratamiento(
  prestacionId: string,
  pct: number,
  profesionalId = 'prof-1',
): ConfigTratamientoCalculo {
  return {
    id: `cfgtrat-${prestacionId}-${profesionalId}`,
    profesional_id: profesionalId,
    prestacion_id: prestacionId,
    pct,
  };
}

/** Pendiente detección (a) de D12: anulaciones sin ajuste vigente. */
function anulacion(
  itemOrigenId: string,
  pagoId: string,
  monto: number,
  anuladoEn: string | null = '2026-11-20T00:00:00.000Z',
): AnulacionPendienteRow {
  return {
    item_origen_id: itemOrigenId,
    pago_id: pagoId,
    monto_comision_original_centavos: monto,
    anulado_en: anuladoEn,
  };
}

/** Pendiente detección (b) de D12: restos de filas consumido. */
function arrastre(
  itemOrigenId: string,
  pagoId: string,
  resto: number,
  primerAnuladoEn: string | null = '2026-11-20T00:00:00.000Z',
): SaldoArrastreRow {
  return {
    item_origen_id: itemOrigenId,
    pago_id: pagoId,
    resto_centavos: resto,
    primer_anulado_en: primerAnuladoEn,
  };
}

function calcular(
  cobros: CobroElegibleComisionRow[],
  configGeneralF: ConfigGeneralCalculo | null = configGeneral(20),
  tratamientos: ConfigTratamientoCalculo[] = [],
  contexto?: Parameters<typeof calcularLiquidacion>[0]['contexto'],
): ResultadoCalculo {
  return calcularLiquidacion({
    cobros,
    configGeneral: configGeneralF,
    configsTratamiento: tratamientos,
    // exactOptionalPropertyTypes: `contexto` solo útil cuando fue provisto.
    ...(contexto !== undefined ? { contexto } : {}),
  });
}

describe('comisiones/calculo (C-13, task 4.1)', () => {
  it('Dado un cobro por turno atribuido sin config específica Cuando calculo Entonces genera UN ítem general con snapshot completo y comisión truncada', () => {
    const resultado = calcular([cobro('pag-a')]);
    expect(resultado.items).toEqual([
      {
        pago_id: 'pag-a',
        turno_id: 'tur-1',
        fecha_contable: '2026-11-10',
        monto_cobro_centavos: 100000,
        pct_aplicado: 20,
        regla_aplicada: 'general',
        monto_comision_centavos: 20000,
      },
    ]);
    expect(resultado.descartes).toEqual([]);
    expect(resultado.ajustes).toEqual([]);
    expect(resultado.totales).toEqual({
      monto_items_centavos: 20000,
      monto_ajustes_centavos: 0,
      monto_total_centavos: 20000,
    });
  });

  it('Dado config específica vigente del par (profesional, prestación) Cuando calculo Entonces el % específico REEMPLAZA al general (nunca se suman; RN-08)', () => {
    const resultado = calcular(
      [cobro('pag-a')],
      configGeneral(40),
      [tratamiento('pres-1', 30)],
    );
    expect(resultado.items[0].pct_aplicado).toBe(30);
    expect(resultado.items[0].regla_aplicada).toBe('tratamiento');
    expect(resultado.items[0].monto_comision_centavos).toBe(30000);
  });

  it('Dado prestación sin config específica Cuando calculo Entonces aplica el pct general del profesional', () => {
    const resultado = calcular(
      [cobro('pag-a')],
      configGeneral(40),
      [tratamiento('pres-2', 30)],
    );
    expect(resultado.items[0].pct_aplicado).toBe(40);
    expect(resultado.items[0].regla_aplicada).toBe('general');
  });

  it('Dado turno sin prestación Cuando calculo Entonces regla general (D2)', () => {
    const resultado = calcular([cobro('pag-a', { prestacion_id: null })]);
    expect(resultado.items[0].pct_aplicado).toBe(20);
    expect(resultado.items[0].regla_aplicada).toBe('general');
  });

  it('Dado cobro por presupuesto con turno del profesional y config específica para esa prestación Cuando calculo Entonces SIEMPRE general (D2/P1: sin atribución fina por presupuesto)', () => {
    const resultado = calcular(
      [cobro('pag-f', { aplicacion: 'presupuesto' })],
      configGeneral(20),
      [tratamiento('pres-1', 90)],
    );
    expect(resultado.items[0].pct_aplicado).toBe(20);
    expect(resultado.items[0].regla_aplicada).toBe('general');
    expect(resultado.items[0].monto_comision_centavos).toBe(20000);
  });

  it('Dado candidatos con motivos de atribución Cuando calculo Entonces quedan en descartes con motivo EXPLÍCITO y sin ítem (nunca exclusión silenciosa; D2)', () => {
    const resultado = calcular([
      cobro('pag-g', {
        turno_id: null,
        prestacion_id: null,
        motivo_descarte: 'no_atribuible',
      }),
      cobro('pag-j', { motivo_descarte: 'doble_referencia_incompatible' }),
      cobro('pag-k', { motivo_descarte: 'turno_no_atendido' }),
    ]);
    expect(resultado.items).toEqual([]);
    expect(resultado.descartes).toEqual([
      { pago_id: 'pag-g', motivo: 'no_atribuible' },
      { pago_id: 'pag-j', motivo: 'doble_referencia_incompatible' },
      { pago_id: 'pag-k', motivo: 'turno_no_atendido' },
    ]);
    expect(resultado.totales).toEqual({
      monto_items_centavos: 0,
      monto_ajustes_centavos: 0,
      monto_total_centavos: 0,
    });
  });

  it('Dado cobro ya liquidado en otra liquidación vigente Cuando calculo Entonces descarte cobro_ya_liquidado y el guard D7 prevalece sobre el motivo de atribución', () => {
    const resultado = calcular(
      [cobro('pag-x', { motivo_descarte: 'no_atribuible' }), cobro('pag-a')],
      configGeneral(20),
      [],
      { pagosYaLiquidados: ['pag-x'] },
    );
    expect(resultado.items.map((i) => i.pago_id)).toEqual(['pag-a']);
    // pag-x llevaba motivo de atribución `no_atribuible`, pero el guard D7 lo
    // intercepta PRIMERO: el descarte consultable es cobro_ya_liquidado.
    expect(resultado.descartes).toEqual([
      { pago_id: 'pag-x', motivo: 'cobro_ya_liquidado' },
    ]);
  });

  it('Dado config general ausente Cuando calculo Entonces todos los candidatos quedan sin_configuracion y los ajustes pendientes igual se exponen (neto − ajustes)', () => {
    const resultado = calcular(
      [cobro('pag-a'), cobro('pag-b', { monto_centavos: 50000 })],
      null,
      [],
      { anulacionesPendientes: [anulacion('it-orig-1', 'pag-z', 20000)] },
    );
    expect(resultado.items).toEqual([]);
    expect(resultado.descartes).toEqual([
      { pago_id: 'pag-a', motivo: 'sin_configuracion' },
      { pago_id: 'pag-b', motivo: 'sin_configuracion' },
    ]);
    expect(resultado.ajustes).toEqual([
      { item_origen_id: 'it-orig-1', pago_id: 'pag-z', tipo_ajuste: 'anulacion_cobro', monto_ajuste_centavos: 20000 },
    ]);
    expect(resultado.totales).toEqual({
      monto_items_centavos: 0,
      monto_ajustes_centavos: 20000,
      monto_total_centavos: -20000,
    });
  });

  it('Dado montos que no redondean exacto Cuando calculo Entonces truncado hacia abajo (floor, Q5) sin errores de precisión float', () => {
    expect(truncarComision(100001, 20)).toBe(20000);
    expect(truncarComision(9999, 20)).toBe(1999);
    expect(truncarComision(123457, 30)).toBe(37037);
    const resultado = calcular([cobro('pag-n', { monto_centavos: 100001 })]);
    expect(resultado.items[0].monto_comision_centavos).toBe(20000);
  });

  it('Dado límite de representación de double (2^53-2 al 100 %) Cuando calculo con BigInt Entonces comisión EXACTA (R2): un float deriva el producto', () => {
    const monto = 9007199254740990;
    expect(truncarComision(monto, 100)).toBe(monto);
    expect(Number.isSafeInteger(truncarComision(monto, 100))).toBe(true);
  });

  it('Dado 0 % y 100 % Cuando calculo Entonces comisión 0 y monto completo respectivamente', () => {
    expect(truncarComision(12345, 0)).toBe(0);
    const cero = calcular(
      [cobro('pag-a')],
      { ...configGeneral(0), updated_at: '2026-11-01T00:00:00.000Z' },
    );
    expect(cero.items[0].monto_comision_centavos).toBe(0);
    const full = calcular(
      [cobro('pag-a', { monto_centavos: 77777 })],
      { ...configGeneral(100) },
    );
    expect(full.items[0].monto_comision_centavos).toBe(77777);
  });

  it('Dado 3 pagos parciales del mismo turno Cuando calculo Entonces 3 ítems INDEPENDIENTES (uno por pago, D1) y total = Σ de sus comisiones', () => {
    const resultado = calcular([
      cobro('pag-1', { monto_centavos: 10000 }),
      cobro('pag-2', { monto_centavos: 7000 }),
      cobro('pag-3', { monto_centavos: 13000 }),
    ], configGeneral(40));
    expect(resultado.items).toHaveLength(3);
    expect(resultado.items.map((i) => i.monto_comision_centavos)).toEqual([
      4000,
      2800,
      5200,
    ]);
    expect(resultado.totales).toEqual({
      monto_items_centavos: 12000,
      monto_ajustes_centavos: 0,
      monto_total_centavos: 12000,
    });
  });

  it('Dado anulaciones pendientes Cuando calculo Entonces ajuste anulacion_cobro con la comisión ORIGINAL declarada (sin recalcular) y neto restado', () => {
    const resultado = calcular(
      [cobro('pag-a')],
      configGeneral(20),
      [],
      { anulacionesPendientes: [anulacion('it-orig-1', 'pag-z', 25000, '2026-11-20T00:00:00.000Z')] },
    );
    expect(resultado.items[0].monto_comision_centavos).toBe(20000);
    expect(resultado.ajustes).toEqual([
      { item_origen_id: 'it-orig-1', pago_id: 'pag-z', tipo_ajuste: 'anulacion_cobro', monto_ajuste_centavos: 25000 },
    ]);
    expect(resultado.totales).toEqual({
      monto_items_centavos: 20000,
      monto_ajustes_centavos: 25000,
      monto_total_centavos: -5000,
    });
  });

  it('Dado anulaciones con comisión original 0 Cuando calculo Entonces sin ajuste (el CHECK DDL exige monto_ajuste > 0)', () => {
    const resultado = calcular(
      [cobro('pag-a')],
      configGeneral(20),
      [],
      { anulacionesPendientes: [anulacion('it-orig-1', 'pag-z', 0)] },
    );
    expect(resultado.ajustes).toEqual([]);
    expect(resultado.totales).toEqual({
      monto_items_centavos: 20000,
      monto_ajustes_centavos: 0,
      monto_total_centavos: 20000,
    });
  });

  it('Dado saldos de arrastre (restos de absorciones consumidas) Cuando calculo Entonces ajuste saldo_arrastre con el resto pendiente > 0', () => {
    const resultado = calcular(
      [cobro('pag-a')],
      configGeneral(20),
      [],
      { saldosArrastre: [arrastre('it-orig-1', 'pag-z', 5000, '2026-11-19T00:00:00.000Z')] },
    );
    expect(resultado.ajustes).toEqual([
      { item_origen_id: 'it-orig-1', pago_id: 'pag-z', tipo_ajuste: 'saldo_arrastre', monto_ajuste_centavos: 5000 },
    ]);
    expect(resultado.totales).toEqual({
      monto_items_centavos: 20000,
      monto_ajustes_centavos: 5000,
      monto_total_centavos: 15000,
    });
  });

  it('Dado un ítem de origen presente en las detecciones (a) Y (b) Cuando calculo Entonces dedup: el arrastre (resto real) manda y NO se doble-cuenta (D12)', () => {
    const resultado = calcular(
      [cobro('pag-a')],
      configGeneral(20),
      [],
      {
        anulacionesPendientes: [anulacion('it-orig-1', 'pag-z', 20000)],
        saldosArrastre: [arrastre('it-orig-1', 'pag-z', 5000)],
      },
    );
    expect(resultado.ajustes).toEqual([
      { item_origen_id: 'it-orig-1', pago_id: 'pag-z', tipo_ajuste: 'saldo_arrastre', monto_ajuste_centavos: 5000 },
    ]);
    expect(resultado.totales.monto_ajustes_centavos).toBe(5000);
  });

  it('Dado varios pendientes Cuando calculo Entonces absorción listada in-order (anulado_en ASC, pago_id ASC, item_origen ASC — D12) INDEPENDIENTE del orden del input', () => {
    const esperado = [
      { item_origen_id: 'it-orig-4', pago_id: 'pag-n', tipo_ajuste: 'saldo_arrastre', monto_ajuste_centavos: 4000 },
      { item_origen_id: 'it-orig-3', pago_id: 'pag-m', tipo_ajuste: 'saldo_arrastre', monto_ajuste_centavos: 3000 },
      { item_origen_id: 'it-orig-1', pago_id: 'pag-m', tipo_ajuste: 'anulacion_cobro', monto_ajuste_centavos: 1000 },
      { item_origen_id: 'it-orig-2', pago_id: 'pag-n', tipo_ajuste: 'anulacion_cobro', monto_ajuste_centavos: 2000 },
    ];
    const entradaShuffle1 = {
      anulacionesPendientes: [
        anulacion('it-orig-2', 'pag-n', 2000, '2026-11-21T00:00:00.000Z'),
        anulacion('it-orig-1', 'pag-m', 1000, '2026-11-20T00:00:00.000Z'),
      ],
      saldosArrastre: [
        arrastre('it-orig-4', 'pag-n', 4000, null),
        arrastre('it-orig-3', 'pag-m', 3000, '2026-11-19T00:00:00.000Z'),
      ],
    };
    const resultado = calcular(
      [cobro('pag-a')],
      configGeneral(20),
      [],
      entradaShuffle1,
    );
    expect(resultado.ajustes).toEqual(esperado);

    // Segundo barajado distinto del primero: mismo resultado (idempotencia del orden).
    const entradaShuffle2 = {
      anulacionesPendientes: [
        anulacion('it-orig-1', 'pag-m', 1000, '2026-11-20T00:00:00.000Z'),
        anulacion('it-orig-2', 'pag-n', 2000, '2026-11-21T00:00:00.000Z'),
      ],
      saldosArrastre: [
        arrastre('it-orig-3', 'pag-m', 3000, '2026-11-19T00:00:00.000Z'),
        arrastre('it-orig-4', 'pag-n', 4000, null),
      ],
    };
    expect(calcular([cobro('pag-a')], configGeneral(20), [], entradaShuffle2).ajustes).toEqual(esperado);
  });

  it('Dado configs específicas de OTRO profesional Cuando calculo Entonces no se aplican (defensa de la capa pura; par excluido por profesional)', () => {
    const resultado = calcular(
      [cobro('pag-a')],
      configGeneral(20),
      [tratamiento('pres-1', 99, 'prof-2')],
    );
    expect(resultado.items[0].pct_aplicado).toBe(20);
    expect(resultado.items[0].regla_aplicada).toBe('general');
  });

  it('Dado cambio de % intra-período Cuando recalculo con la config vigente Entonces los ítems usan el % vigente al calcular (no retroactivo; D4)', () => {
    const cobros = [cobro('pag-a', { monto_centavos: 100000 })];
    const antes = calcular(cobros, configGeneral(20));
    const despues = calcular(cobros, configGeneral(25));
    expect(antes.items[0].monto_comision_centavos).toBe(20000);
    expect(despues.items[0].monto_comision_centavos).toBe(25000);
    expect(cobros[0].monto_centavos).toBe(100000); // el input no cambió (motor sin efectos)
  });

  it('Dado entradas congeladas Cuando calculo dos veces Entonces resultados idénticos y SIN mutación de los inputs (función pura, D8/D10)', () => {
    const cobroA = Object.freeze(cobro('pag-a'));
    const cobroB = Object.freeze(cobro('pag-b', { motivo_descarte: 'no_atribuible' }));
    const config = Object.freeze(configGeneral(20));
    const cobros = Object.freeze([cobroB, cobroA]);
    const run1 = calcularLiquidacion({ cobros, configGeneral: config, configsTratamiento: [] });
    const run2 = calcularLiquidacion({ cobros, configGeneral: config, configsTratamiento: [] });
    expect(run1).toEqual(run2);
    expect(run1.items.map((i) => i.pago_id)).toEqual(['pag-a']);
    expect(cobros.map((c) => c.pago_id)).toEqual(['pag-b', 'pag-a']);
  });

  it('Dado ítems y descartes mezclados con pagos desordenados Cuando calculo Entonces orden canon pago_id ASC en ítems y descartes (D13)', () => {
    const resultado = calcular([
      cobro('pag-z', { motivo_descarte: 'no_atribuible' }),
      cobro('pag-m', { monto_centavos: 50000 }),
      cobro('pag-a'),
    ]);
    expect(resultado.items.map((i) => i.pago_id)).toEqual(['pag-a', 'pag-m']);
    expect(resultado.descartes.map((d) => d.pago_id)).toEqual(['pag-z']);
  });
});
