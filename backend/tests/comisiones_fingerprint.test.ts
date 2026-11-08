/**
 * Task 4.3: fingerprint SHA-256 del cálculo de comisiones (C-13, design D13).
 * Suite 100% unitaria (sin SQLite): la función pura serializa canónicamente la
 * semilla y hashea — determinismo, sensibilidad a cambios relevantes y
 * estabilidad ante reordenamientos. Escenarios Dado/Cuando/Entonces (R11),
 * datos estrictamente ficticios (R1/R12).
 */
import { describe, expect, it } from 'vitest';
import type { CobroElegibleComisionRow } from '../src/core/pago.repository.js';
import type {
  AjustePendienteCalculado,
  ConfigGeneralCalculo,
  ConfigTratamientoCalculo,
} from '../src/comisiones/calculo.js';
import {
  calcularFingerprint,
  type EntradaFingerprintComision,
} from '../src/comisiones/fingerprint.js';

/** SHA-256 canónico: hex lowercase de exactamente 64 caracteres. */
const SHA256_RE = /^[0-9a-f]{64}$/;

function configGeneral(
  pct: number,
  overrides: Partial<ConfigGeneralCalculo> = {},
): ConfigGeneralCalculo {
  return {
    id: 'cfg-general',
    profesional_id: 'prof-1',
    pct_general: pct,
    updated_at: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function tratamiento(
  prestacionId: string,
  pct: number,
  id = `cfgtrat-${prestacionId}`,
): ConfigTratamientoCalculo {
  return { id, profesional_id: 'prof-1', prestacion_id: prestacionId, pct };
}

function cobro(
  pagoId: string,
  overrides: Partial<CobroElegibleComisionRow> = {},
): CobroElegibleComisionRow {
  return {
    pago_id: pagoId,
    monto_centavos: 100000,
    medio: 'efectivo',
    turno_id: 'tur-1',
    prestacion_id: 'pres-1',
    aplicacion: 'turno',
    fecha_contable: '2026-11-10',
    motivo_descarte: null,
    ...overrides,
  };
}

function ajuste(
  itemOrigenId: string,
  pagoId: string,
  tipoAjuste: AjustePendienteCalculado['tipo_ajuste'],
  monto: number,
): AjustePendienteCalculado {
  return {
    item_origen_id: itemOrigenId,
    pago_id: pagoId,
    tipo_ajuste: tipoAjuste,
    monto_ajuste_centavos: monto,
  };
}

/** Entrada lógica base: 2 elegibles + 1 descartado + 2 configs específicas + 2 ajustes. */
function entrada(): EntradaFingerprintComision {
  return {
    profesional_id: 'prof-1',
    desde: '2026-11-01',
    hasta: '2026-11-30',
    config_general: configGeneral(20),
    tratamientos: [tratamiento('pres-1', 30), tratamiento('pres-2', 25)],
    cobros: [
      cobro('pag-a'),
      cobro('pag-f', { aplicacion: 'presupuesto', prestacion_id: null }),
      cobro('pag-z', { motivo_descarte: 'no_atribuible', turno_id: null, prestacion_id: null }),
    ],
    ajustes_pendientes: [
      ajuste('it-orig-1', 'pag-y', 'anulacion_cobro', 20000),
      ajuste('it-orig-2', 'pag-x', 'saldo_arrastre', 5000),
    ],
  };
}

describe('comisiones/fingerprint (C-13, task 4.3)', () => {
  it('Dado la misma entrada lógica construida dos veces (con arrays barajados) Cuando calculo Entonces hashes idénticos, hex lowercase de 64 (canonización sin locale, D13)', () => {
    const entradaBase = entrada();
    const base = calcularFingerprint(entradaBase);
    expect(base).toMatch(SHA256_RE);
    const barajada = calcularFingerprint({
      ...entradaBase,
      tratamientos: [tratamiento('pres-2', 25), tratamiento('pres-1', 30)],
      cobros: [
        cobro('pag-z', { motivo_descarte: 'no_atribuible', turno_id: null, prestacion_id: null }),
        cobro('pag-f', { aplicacion: 'presupuesto', prestacion_id: null }),
        cobro('pag-a'),
      ],
      ajustes_pendientes: [
        ajuste('it-orig-2', 'pag-x', 'saldo_arrastre', 5000),
        ajuste('it-orig-1', 'pag-y', 'anulacion_cobro', 20000),
      ],
    });
    expect(barajada).toBe(base);
    expect(calcularFingerprint(entrada())).toBe(base);
  });

  it('Dado pct_general distinto Cuando calculo Entonces hash distinto (el % general es insumo decisivo del cálculo)', () => {
    const base = calcularFingerprint(entrada());
    expect(calcularFingerprint({ ...entrada(), config_general: configGeneral(21) })).not.toBe(base);
  });

  it('Dado la config general re-sellada (nuevo id o nuevo updated_at) con el MISMO pct Cuando calculo Entonces hash distinto: la vigente entra EXACTA {id, updated_at, pct_general} (D13)', () => {
    const base = calcularFingerprint(entrada());
    expect(
      calcularFingerprint({
        ...entrada(),
        config_general: configGeneral(20, { updated_at: '2026-11-02T00:00:00.000Z' }),
      }),
    ).not.toBe(base);
    expect(
      calcularFingerprint({
        ...entrada(),
        config_general: configGeneral(20, { id: 'cfg-general-v2' }),
      }),
    ).not.toBe(base);
  });

  it('Dado configs específicas re-creadas con el mismo pct (nuevo id) y reordenadas Cuando calculo Entonces hash SIN cambio (solo {prestacion_id, pct} importan); Dado pct específico distinto Entonces hash distinto', () => {
    const base = calcularFingerprint(entrada());
    const recreada = calcularFingerprint({
      ...entrada(),
      tratamientos: [tratamiento('pres-2', 25, 'cfgtrat-nueva-2'), tratamiento('pres-1', 30, 'cfgtrat-nueva-1')],
    });
    expect(recreada).toBe(base);
    const pctCambiado = calcularFingerprint({
      ...entrada(),
      tratamientos: [tratamiento('pres-1', 31), tratamiento('pres-2', 25)],
    });
    expect(pctCambiado).not.toBe(base);
  });

  it('Dado un cobro ELEGIBLE con otro monto / medio / fecha_contable / turno_id / prestacion_id / aplicacion Cuando calculo Entonces hash distinto en cada variante (snapshot completo del cobro en la semilla, D13)', () => {
    const base = calcularFingerprint(entrada());
    const variantes: Partial<CobroElegibleComisionRow>[] = [
      { monto_centavos: 99999 },
      { medio: 'transferencia' },
      { fecha_contable: '2026-11-11' },
      { turno_id: 'tur-2', prestacion_id: 'pres-2' },
      { prestacion_id: 'pres-2' },
      { aplicacion: 'presupuesto' },
    ];
    for (const variante of variantes) {
      const conVariante = calcularFingerprint({
        ...entrada(),
        cobros: [
          cobro('pag-a', variante),
          cobro('pag-f', { aplicacion: 'presupuesto', prestacion_id: null }),
          cobro('pag-z', { motivo_descarte: 'no_atribuible', turno_id: null, prestacion_id: null }),
        ],
      });
      expect(conVariante).not.toBe(base);
    }
  });

  it('Dado un cobro que pasa de ELEGIBLE a descartado (motivo no null) Cuando calculo Entonces hash distinto: cambia el conjunto canónico de elegibles', () => {
    const base = calcularFingerprint(entrada());
    const cambiado = calcularFingerprint({
      ...entrada(),
      cobros: [
        cobro('pag-a', { motivo_descarte: 'turno_no_atendido' }),
        cobro('pag-f', { aplicacion: 'presupuesto', prestacion_id: null }),
        cobro('pag-z', { motivo_descarte: 'no_atribuible', turno_id: null, prestacion_id: null }),
      ],
    });
    expect(cambiado).not.toBe(base);
  });

  it('Dado dos entradas que difieren SOLO en el motivo del descartado Cuando calculo Entonces hashes idénticos: los motivos de los descartados son metadata consultable fuera del resultado (D13)', () => {
    const conNoAtribuible = calcularFingerprint(entrada());
    const conTurnoNoAtendido = calcularFingerprint({
      ...entrada(),
      cobros: [
        cobro('pag-a'),
        cobro('pag-f', { aplicacion: 'presupuesto', prestacion_id: null }),
        cobro('pag-z', { motivo_descarte: 'turno_no_atendido', turno_id: null, prestacion_id: null }),
      ],
    });
    expect(conTurnoNoAtendido).toBe(conNoAtribuible);
  });

  it('Dado ajustes con otro monto / otro tipo / uno nuevo Cuando calculo Entonces hash distinto por cambio relevante; Dado el mismo conjunto barajado Entonces hash estable (orden canon de la semilla, D13)', () => {
    const base = calcularFingerprint(entrada());
    expect(
      calcularFingerprint({
        ...entrada(),
        ajustes_pendientes: [
          ajuste('it-orig-1', 'pag-y', 'anulacion_cobro', 19999),
          ajuste('it-orig-2', 'pag-x', 'saldo_arrastre', 5000),
        ],
      }),
    ).not.toBe(base);
    expect(
      calcularFingerprint({
        ...entrada(),
        ajustes_pendientes: [
          ajuste('it-orig-1', 'pag-y', 'saldo_arrastre', 20000),
          ajuste('it-orig-2', 'pag-x', 'saldo_arrastre', 5000),
        ],
      }),
    ).not.toBe(base);
    expect(
      calcularFingerprint({
        ...entrada(),
        ajustes_pendientes: [
          ajuste('it-orig-1', 'pag-y', 'anulacion_cobro', 20000),
          ajuste('it-orig-2', 'pag-x', 'saldo_arrastre', 5000),
          ajuste('it-orig-3', 'pag-w', 'anulacion_cobro', 1000),
        ],
      }),
    ).not.toBe(base);
    expect(
      calcularFingerprint({
        ...entrada(),
        ajustes_pendientes: [
          ajuste('it-orig-2', 'pag-x', 'saldo_arrastre', 5000),
          ajuste('it-orig-1', 'pag-y', 'anulacion_cobro', 20000),
        ],
      }),
    ).toBe(base);
  });

  it('Dado ausencia de config general (null) versus config presente Cuando calculo Entonces hash distinto (sin config no se resuelve NINGÚN %)', () => {
    const base = calcularFingerprint(entrada());
    expect(calcularFingerprint({ ...entrada(), config_general: null })).not.toBe(base);
  });

  it('Dado un cobro capturado por un borrador ajeno (pagos_ya_liquidados no vacío) Cuando calculo Entonces hash distinto; omitir equivale a lista vacía y el orden es irrelevante (D13/P2: el perdedor de la carrera debe recibir 409, no recalcular)', () => {
    const base = calcularFingerprint(entrada());
    expect(
      calcularFingerprint({ ...entrada(), pagos_ya_liquidados: ['pag-a'] }),
    ).not.toBe(base);
    expect(
      calcularFingerprint({ ...entrada(), pagos_ya_liquidados: [] }),
    ).toBe(base);
    expect(
      calcularFingerprint({ ...entrada(), pagos_ya_liquidados: ['pag-f', 'pag-a'] }),
    ).toBe(
      calcularFingerprint({ ...entrada(), pagos_ya_liquidados: ['pag-a', 'pag-f'] }),
    );
  });
});
