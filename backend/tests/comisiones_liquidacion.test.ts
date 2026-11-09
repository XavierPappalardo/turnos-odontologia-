/**
 * Tasks 3.2 y 3.3: repositorios de liquidación de comisiones (C-13).
 * - Cabecera, ítems-snapshot, ajustes (reserva exclusiva / liberación / consumo
 *   / pendientes) y eventos insert-only: SQLite REAL en memoria (R12: sin
 *   mocks de transacción), UnitOfWork intra-tx para la semántica transaccional.
 * - `PagoRepository.listarCobrosElegiblesComision`: política D2 (turno
 *   referencia principal), exclusión con motivo consultable, fecha contable Q3.
 * Datos estrictamente ficticios (R1/R12).
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, UnitOfWork } from '../src/shared/repository.js';
import { EventoInmutableError } from '../src/shared/errors.js';
import { LiquidacionComisionRepository } from '../src/comisiones/liquidacion.repository.js';
import { LiquidacionItemRepository } from '../src/comisiones/liquidacionItem.repository.js';
import { LiquidacionAjusteRepository } from '../src/comisiones/liquidacionAjuste.repository.js';
import { LiquidacionEventoRepository } from '../src/comisiones/liquidacionEvento.repository.js';
import { PagoRepository } from '../src/core/pago.repository.js';

const AHORA = new Date().toISOString();
/** Fecha de negocio fija para todo pago SIN movimiento (determinismo R12). */
const CREATED_PAGO_FIJO = '2026-11-05T12:00:00.000Z';

function sembrarEntidadesBase(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO sillon (id, nombre, activo, created_at, updated_at)
     VALUES ('sil-1', 'Sillón Ficticio', 1, ?, ?)`,
  ).run(AHORA, AHORA);
  db.prepare(
    `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at)
     VALUES ('prof-1', 'Odontologo Ficticio Uno', 'MN-1111', 'Odontología', 1, ?, ?),
            ('prof-2', 'Odontologo Ficticio Dos', 'MN-2222', 'Odontología', 1, ?, ?)`,
  ).run(AHORA, AHORA, AHORA, AHORA);
  db.prepare(
    `INSERT INTO usuario (id, email, password_hash, activo, created_at, updated_at)
     VALUES ('usr-1', 'admin@example.test', 'hash', 1, ?, ?)`,
  ).run(AHORA, AHORA);
  db.prepare(
    `INSERT INTO obra_social_plan (id, obra_social, plan, cobertura_pct, activo, created_at, updated_at)
     VALUES ('osp-1', 'OS Ficticia', '210', 80, 1, ?, ?)`,
  ).run(AHORA, AHORA);
  db.prepare(
    `INSERT INTO paciente (id, nombre, telefono_whatsapp, obra_social_plan_id, activo, created_at, updated_at)
     VALUES ('pac-1', 'Paciente Ficticio', '+54 9 11 0000-0000', 'osp-1', 1, ?, ?)`,
  ).run(AHORA, AHORA);
  db.prepare(
    `INSERT INTO prestacion (id, codigo, nombre, duracion_min, created_at, updated_at)
     VALUES ('pres-1', 'CONS-01', 'Consulta Ficticia', 30, ?, ?),
            ('pres-2', 'RES-02', 'Restauración Ficticia', 60, ?, ?)`,
  ).run(AHORA, AHORA, AHORA, AHORA);
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at)
     VALUES
       ('tur-1', 'prof-1', 'sil-1', 'pac-1', 'pres-1', '2026-11-01T10:00:00.000Z', '2026-11-01T10:30:00.000Z', 'atendido', 'recepcion', ?, ?),
       ('tur-2', 'prof-1', 'sil-1', 'pac-1', 'pres-2', '2026-11-03T10:00:00.000Z', '2026-11-03T10:30:00.000Z', 'atendido', 'recepcion', ?, ?)`,
  ).run(AHORA, AHORA, AHORA, AHORA);
}

function insertarPago(
  db: DatabaseSync,
  fila: {
    id: string;
    turnoId: string | null;
    presupuestoId: string | null;
    monto?: number;
    medio?: string;
    estado?: string;
    anuladoEn?: string | null;
    createdAt?: string;
  },
): void {
  db.prepare(
    `INSERT INTO pago (
      id, turno_id, presupuesto_id, monto_centavos, moneda, medio, estado,
      clave_idempotencia, referencia, actor_usuario_id,
      anulado_por_usuario_id, motivo_anulacion, anulado_en,
      created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, 'ARS', ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, NULL)`,
  ).run(
    fila.id,
    fila.turnoId,
    fila.presupuestoId,
    fila.monto ?? 100000,
    fila.medio ?? 'efectivo',
    fila.estado ?? 'cobrado',
    fila.anuladoEn ?? null,
    fila.createdAt ?? CREATED_PAGO_FIJO,
    AHORA,
  );
}

function insertarMovimiento(
  db: DatabaseSync,
  args: { id: string; pagoId: string; fecha: string; tipo?: 'cobro' | 'anulacion' },
): void {
  db.prepare(
    `INSERT INTO movimiento_caja (
      id, pago_id, tipo, monto_centavos, moneda, actor_usuario_id,
      fecha_contable, aplicado_en, motivo_asignacion, created_at
    ) VALUES (?, ?, ?, 1000, 'ARS', 'usr-1', ?, ?, NULL, ?)`,
  ).run(args.id, args.pagoId, args.tipo ?? 'cobro', args.fecha, args.fecha, AHORA);
}

/**
 * Presupuesto ficticio (esquema 009; estado 'aceptado', sin plan de OS) para
 * los pagos de la rama `presupuesto` de la política D2 en el describe de 3.3.
 */
function insertarPresupuesto(
  db: DatabaseSync,
  args: { id: string; turnoId: string | null },
): void {
  db.prepare(
    `INSERT INTO presupuesto (
      id, paciente_id, turno_id, estado, total_centavos, cobertura_centavos,
      saldo_centavos, obra_social_plan_id, created_at, updated_at, deleted_at
    ) VALUES (?, 'pac-1', ?, 'aceptado', 100000, 0, 0, NULL, ?, ?, NULL)`,
  ).run(args.id, args.turnoId, AHORA, AHORA);
}

describe('comisiones/repositorios de liquidación (C-13, task 3.2)', () => {
  let db: DatabaseSync;
  let uow: UnitOfWork;
  let cabeceras: LiquidacionComisionRepository;
  let items: LiquidacionItemRepository;
  let ajustes: LiquidacionAjusteRepository;
  let eventos: LiquidacionEventoRepository;

  const insertarCabecera = (
    dbActual: DatabaseSync,
    fila: {
      id: string;
      profesional_id?: string;
      estado?: 'borrador' | 'confirmada';
      items?: number;
      ajustes?: number;
      total?: number;
      saldo?: number;
      desde?: string;
      hasta?: string;
    },
  ): void => {
    const estado = fila.estado ?? 'borrador';
    const valorItems = fila.items ?? 0;
    const valorAjustes = fila.ajustes ?? 0;
    const total = fila.total ?? valorItems - valorAjustes;
    const saldo =
      fila.saldo === undefined
        ? estado === 'borrador'
          ? 0
          : Math.max(0, valorAjustes - valorItems)
        : fila.saldo;
    new LiquidacionComisionRepository(dbActual).insert({
      id: fila.id,
      profesional_id: fila.profesional_id ?? 'prof-1',
      desde: fila.desde ?? '2026-11-01T00:00:00.000Z',
      hasta: fila.hasta ?? '2026-11-30T00:00:00.000Z',
      estado,
      monto_items_centavos: valorItems,
      monto_ajustes_centavos: valorAjustes,
      monto_total_centavos: total,
      saldo_compensacion_centavos: saldo,
      fingerprint: 'hash-ficticio',
      deleted_at: null,
    });
  };

  const insertarItem = (
    dbActual: DatabaseSync,
    fila: {
      id: string;
      liquidacion_id: string;
      pago_id: string;
      turno_id?: string;
      fecha_contable?: string;
    },
  ): void => {
    new LiquidacionItemRepository(dbActual).insert({
      id: fila.id,
      liquidacion_id: fila.liquidacion_id,
      pago_id: fila.pago_id,
      turno_id: fila.turno_id ?? 'tur-1',
      fecha_contable: fila.fecha_contable ?? '2026-11-05',
      monto_cobro_centavos: 100000,
      pct_aplicado: 20,
      regla_aplicada: 'general',
      monto_comision_centavos: 20000,
    });
  };

  beforeEach(() => {
    db = openDatabase(':memory:');
    sembrarEntidadesBase(db);
    insertarPago(db, { id: 'pag-1', turnoId: 'tur-1', presupuestoId: null });
    uow = new UnitOfWork(db);
    cabeceras = new LiquidacionComisionRepository(db);
    items = new LiquidacionItemRepository(db);
    ajustes = new LiquidacionAjusteRepository(db);
    eventos = new LiquidacionEventoRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('Dado cabecera borrador persistida Cuando busco por id y por período vigente Entonces la encuentra y el período exacto es único', () => {
    insertarCabecera(db, { id: 'liq-1' });
    const encontrada = cabeceras.buscarPorIdVigente('liq-1');
    expect(encontrada!.estado).toBe('borrador');
    expect(encontrada!.saldo_compensacion_centavos).toBe(0);
    expect(
      cabeceras.buscarPorProfesionalYPeriodoVigente(
        'prof-1',
        '2026-11-01T00:00:00.000Z',
        '2026-11-30T00:00:00.000Z',
      )!.id,
    ).toBe('liq-1');
    expect(
      cabeceras.buscarPorProfesionalYPeriodoVigente(
        'prof-1',
        '2026-12-01T00:00:00.000Z',
        '2026-12-31T00:00:00.000Z',
      ),
    ).toBeUndefined();
    expect(() => insertarCabecera(db, { id: 'liq-dupe' })).toThrow();
  });

  it('Dado cabeceras de varios profesionales y periodos Cuando listarVigentes Entonces respeta soft delete y filtra por profesional', () => {
    insertarCabecera(db, { id: 'liq-1', desde: '2026-11-01T00:00:00.000Z' });
    insertarCabecera(db, {
      id: 'liq-2',
      desde: '2026-12-01T00:00:00.000Z',
      hasta: '2026-12-31T00:00:00.000Z',
    });
    insertarCabecera(db, {
      id: 'liq-otro',
      profesional_id: 'prof-2',
      desde: '2026-11-01T00:00:00.000Z',
    });
    expect(cabeceras.listarVigentes('prof-1').map((l) => l.id)).toEqual([
      'liq-2',
      'liq-1',
    ]);
    expect(cabeceras.listarVigentes().map((l) => l.id)).toContain('liq-otro');
    cabeceras.softDelete('liq-2');
    expect(cabeceras.listarVigentes('prof-1').map((l) => l.id)).toEqual(['liq-1']);
  });

  it('Dado cabeceras confirmadas y borradores del profesional Cuando listarConfirmadasPorProfesional Entonces expone SOLO confirmadas (Q6 portal profesional)', () => {
    insertarCabecera(db, { id: 'liq-ok', estado: 'confirmada', items: 20000, total: 20000 });
    insertarCabecera(db, { id: 'liq-borrador', desde: '2026-12-01T00:00:00.000Z', hasta: '2026-12-31T00:00:00.000Z' });
    expect(cabeceras.listarConfirmadasPorProfesional('prof-1').map((l) => l.id)).toEqual([
      'liq-ok',
    ]);
  });

  it('Dado transición borrador → confirmada Cuando se confirma dos veces Entonces el segundo guard devuelve false (terminalidad D5)', () => {
    insertarCabecera(db, { id: 'liq-1' });
    expect(cabeceras.cambiarEstado('liq-1', 'confirmada')).toBe(true);
    const fila = cabeceras.buscarPorIdVigente('liq-1')!;
    expect(fila.estado).toBe('confirmada');
    expect(cabeceras.cambiarEstado('liq-1', 'confirmada')).toBe(false);
  });

  it('Dado montos de borrador Cuando actualizarMontos Entonces aplica; con saldo ≠ 0 el CHECK CASE de 012 aborta; en confirmada devuelve false', () => {
    insertarCabecera(db, { id: 'liq-1' });
    expect(
      cabeceras.actualizarMontos('liq-1', {
        monto_items_centavos: 10000,
        monto_ajustes_centavos: 0,
        monto_total_centavos: 10000,
        saldo_compensacion_centavos: 0,
      }),
    ).toBe(true);
    expect(() =>
      cabeceras.actualizarMontos('liq-1', {
        monto_items_centavos: 0,
        monto_ajustes_centavos: 0,
        monto_total_centavos: 0,
        saldo_compensacion_centavos: 5000,
      }),
    ).toThrow();
    expect(cabeceras.cambiarEstado('liq-1', 'confirmada')).toBe(true);
    expect(
      cabeceras.actualizarMontos('liq-1', {
        monto_items_centavos: 1,
        monto_ajustes_centavos: 0,
        monto_total_centavos: 1,
        saldo_compensacion_centavos: 0,
      }),
    ).toBe(false);
  });

  it('Dado confirmación atomica de borrador con neto negativo Cuando confirmar Entonces fija estado, fingerprint y saldo exacto en un UPDATE; re-confirmar devuelve false', () => {
    insertarCabecera(db, { id: 'liq-conf' });
    expect(
      cabeceras.confirmar('liq-conf', {
        fingerprint: 'fp-confirmado',
        montos: {
          monto_items_centavos: 10000,
          monto_ajustes_centavos: 15000,
          monto_total_centavos: -5000,
          saldo_compensacion_centavos: 5000,
        },
      }),
    ).toBe(true);
    const fila = cabeceras.buscarPorIdVigente('liq-conf')!;
    expect(fila.estado).toBe('confirmada');
    expect(fila.fingerprint).toBe('fp-confirmado');
    expect(fila.saldo_compensacion_centavos).toBe(5000);
    expect(fila.monto_total_centavos).toBe(-5000);
    expect(
      cabeceras.confirmar('liq-conf', {
        fingerprint: 'fp-otro',
        montos: {
          monto_items_centavos: 1,
          monto_ajustes_centavos: 0,
          monto_total_centavos: 1,
          saldo_compensacion_centavos: 0,
        },
      }),
    ).toBe(false);
    expect(cabeceras.actualizarFingerprint('liq-conf', 'fp-otro')).toBe(false);
  });

  it('Dado fingerprint de borrador Cuando actualizarFingerprint Entonces lo aplica; la confirmada queda inmutable', () => {
    insertarCabecera(db, { id: 'liq-1' });
    expect(cabeceras.actualizarFingerprint('liq-1', 'fp-1')).toBe(true);
    expect(cabeceras.buscarPorIdVigente('liq-1')!.fingerprint).toBe('fp-1');
    expect(cabeceras.cambiarEstado('liq-1', 'confirmada')).toBe(true);
    expect(cabeceras.actualizarFingerprint('liq-1', 'fp-2')).toBe(false);
  });

  it('Dado evento append-only Cuando inserto y consulto Entonces lista ordenado; update/softDelete del repositorio y SQL directo abortan (insert-only)', () => {
    insertarCabecera(db, { id: 'liq-1' });
    eventos.insert({
      id: 'evt-1',
      liquidacion_id: 'liq-1',
      evento: 'generada',
      actor_usuario_id: 'usr-1',
      ocurrido_en: '2026-11-05T10:00:00.000Z',
    });
    eventos.insert({
      id: 'evt-2',
      liquidacion_id: 'liq-1',
      evento: 'confirmada',
      actor_usuario_id: 'usr-1',
      ocurrido_en: '2026-11-05T11:00:00.000Z',
    });
    expect(eventos.listarPorLiquidacion('liq-1').map((e) => e.evento)).toEqual([
      'generada',
      'confirmada',
    ]);
    expect(() => eventos.update('evt-1')).toThrow(EventoInmutableError);
    expect(() => eventos.softDelete('evt-1')).toThrow(EventoInmutableError);
    expect(() =>
      db.prepare(`UPDATE liquidacion_comision_evento SET evento = 'generada' WHERE id = 'evt-2'`).run(),
    ).toThrow(/insert-only/);
    expect(() =>
      db.prepare(`DELETE FROM liquidacion_comision_evento WHERE id = 'evt-2'`).run(),
    ).toThrow(/insert-only/);
  });

  it('Dado snapshot inmutable por cobro Cuando inserto el ítem Entonces persiste turno_id, fecha_contable, pct y regla (snapshot D4, sin updated_at)', () => {
    insertarCabecera(db, { id: 'liq-1' });
    insertarItem(db, {
      id: 'it-1',
      liquidacion_id: 'liq-1',
      pago_id: 'pag-1',
      turno_id: 'tur-1',
      fecha_contable: '2026-11-05',
    });
    const fila = items.listarPorLiquidacion('liq-1')[0];
    expect(fila.turno_id).toBe('tur-1');
    expect(fila.fecha_contable).toBe('2026-11-05');
    expect(fila.monto_cobro_centavos).toBe(100000);
    expect(fila.pct_aplicado).toBe(20);
    expect(fila.regla_aplicada).toBe('general');
    expect(fila.monto_comision_centavos).toBe(20000);
    expect(fila.deleted_at).toBeNull();
  });

  it('Dado ítems de una cabecera Cuando sumarVigentesPorLiquidacion Entonces Σ exacta de comisiones vigentes (y 0 tras baja lógica)', () => {
    insertarCabecera(db, { id: 'liq-1' });
    insertarItem(db, { id: 'it-1', liquidacion_id: 'liq-1', pago_id: 'pag-1' });
    expect(items.sumarVigentesPorLiquidacion('liq-1')).toBe(20000);
    expect(items.darDeBajaPorLiquidacion('liq-1')).toBe(1);
    expect(items.sumarVigentesPorLiquidacion('liq-1')).toBe(0);
    expect(items.listarPorLiquidacion('liq-1')).toHaveLength(0);
  });

  it('Dado guard anti doble-comisión Cuando inserto otro ítem del MISMO pago Entonces la UNIQUE parcial de 012 lo impide hasta liberar por baja lógica', () => {
    insertarCabecera(db, { id: 'liq-1' });
    insertarItem(db, { id: 'it-1', liquidacion_id: 'liq-1', pago_id: 'pag-1' });
    expect(() =>
      insertarItem(db, { id: 'it-2', liquidacion_id: 'liq-1', pago_id: 'pag-1' }),
    ).toThrow();
    items.darDeBajaPorLiquidacion('liq-1');
    expect(
      insertarItem(db, { id: 'it-2', liquidacion_id: 'liq-1', pago_id: 'pag-1' }),
    ).toBeUndefined();
    expect(items.buscarPorPagoIdVigente('pag-1')!.id).toBe('it-2');
  });

  it('Dado reserva de ajuste Cuando inserto un ajuste reservado Entonces la fila queda con compensado 0 y compensado_en NULL', () => {
    insertarCabecera(db, { id: 'liq-1' });
    insertarItem(db, { id: 'it-1', liquidacion_id: 'liq-1', pago_id: 'pag-1' });
    insertarCabecera(db, { id: 'liq-2', desde: '2026-12-01T00:00:00.000Z', hasta: '2026-12-31T00:00:00.000Z' });
    ajustes.insertarReservado({
      id: 'aj-1',
      liquidacion_id: 'liq-1',
      item_origen_id: 'it-1',
      pago_id: 'pag-1',
      tipo_ajuste: 'anulacion_cobro',
      monto_ajuste_centavos: 20000,
    });
    const fila = ajustes.listarPorLiquidacion('liq-1')[0];
    expect(fila.estado_ajuste).toBe('reservado');
    expect(fila.monto_compensado_centavos).toBe(0);
    expect(fila.compensado_en).toBeNull();
    expect(fila.deleted_at).toBeNull();
  });

  it('Dado exclusividad de reserva Cuando dos borradores activos reservan el mismo item_origen Entonces el índice parcial aborta y el UnitOfWork hace ROLLBACK completo', () => {
    insertarCabecera(db, { id: 'liq-1' });
    insertarItem(db, { id: 'it-1', liquidacion_id: 'liq-1', pago_id: 'pag-1' });
    insertarCabecera(db, {
      id: 'liq-2',
      desde: '2026-12-01T00:00:00.000Z',
      hasta: '2026-12-31T00:00:00.000Z',
    });
    expect(() =>
      uow.runInTransaction(() => {
        ajustes.insertarReservado({
          id: 'aj-1',
          liquidacion_id: 'liq-1',
          item_origen_id: 'it-1',
          pago_id: 'pag-1',
          tipo_ajuste: 'anulacion_cobro',
          monto_ajuste_centavos: 20000,
        });
        ajustes.insertarReservado({
          id: 'aj-2',
          liquidacion_id: 'liq-2',
          item_origen_id: 'it-1',
          pago_id: 'pag-1',
          tipo_ajuste: 'anulacion_cobro',
          monto_ajuste_centavos: 20000,
        });
      }),
    ).toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM liquidacion_comision_ajuste').get()).toEqual({ n: 0 });
  });

  it('Dado reserva liberada por baja del borrador Cuando se reserva de nuevo en otra cabecera Entonces el índice parcial lo permite (P2/D12)', () => {
    insertarCabecera(db, { id: 'liq-1' });
    insertarItem(db, { id: 'it-1', liquidacion_id: 'liq-1', pago_id: 'pag-1' });
    insertarCabecera(db, { id: 'liq-2', desde: '2026-12-01T00:00:00.000Z', hasta: '2026-12-31T00:00:00.000Z' });
    ajustes.insertarReservado({
      id: 'aj-1',
      liquidacion_id: 'liq-1',
      item_origen_id: 'it-1',
      pago_id: 'pag-1',
      tipo_ajuste: 'anulacion_cobro',
      monto_ajuste_centavos: 20000,
    });
    expect(ajustes.listarReservadosPorLiquidacion('liq-1')).toHaveLength(1);
    expect(ajustes.sumarReservadosPorLiquidacion('liq-1')).toBe(20000);
    expect(ajustes.liberarPorLiquidacion('liq-1')).toBe(1);
    expect(ajustes.listarReservadosPorLiquidacion('liq-1')).toHaveLength(0);
    expect(ajustes.sumarReservadosPorLiquidacion('liq-1')).toBe(0);
    ajustes.insertarReservado({
      id: 'aj-2',
      liquidacion_id: 'liq-2',
      item_origen_id: 'it-1',
      pago_id: 'pag-1',
      tipo_ajuste: 'anulacion_cobro',
      monto_ajuste_centavos: 20000,
    });
    expect(ajustes.listarReservadosPorLiquidacion('liq-2')).toHaveLength(1);
  });

  it('Dado absorción in-order (D12) Cuando consumir Entonces fija estado/compensado/fecha; reclamar de nuevo retorno false y el límite recomputable rechaza', () => {
    insertarCabecera(db, { id: 'liq-1' });
    insertarItem(db, { id: 'it-1', liquidacion_id: 'liq-1', pago_id: 'pag-1' });
    ajustes.insertarReservado({
      id: 'aj-1',
      liquidacion_id: 'liq-1',
      item_origen_id: 'it-1',
      pago_id: 'pag-1',
      tipo_ajuste: 'anulacion_cobro',
      monto_ajuste_centavos: 15000,
    });
    expect(
      ajustes.consumir('aj-1', { montoCompensado: 10000, compensadoEn: '2026-11-20T00:00:00.000Z' }),
    ).toBe(true);
    const fila = ajustes.listarPorLiquidacion('liq-1')[0];
    expect(fila.estado_ajuste).toBe('consumido');
    expect(fila.monto_compensado_centavos).toBe(10000);
    expect(fila.compensado_en).toBe('2026-11-20T00:00:00.000Z');
    expect(
      ajustes.consumir('aj-1', { montoCompensado: 5000, compensadoEn: '2026-11-21T00:00:00.000Z' }),
    ).toBe(false);
    insertarCabecera(db, { id: 'liq-2', desde: '2026-12-01T00:00:00.000Z', hasta: '2026-12-31T00:00:00.000Z' });
    ajustes.insertarReservado({
      id: 'aj-2',
      liquidacion_id: 'liq-2',
      item_origen_id: 'it-1',
      pago_id: 'pag-1',
      tipo_ajuste: 'saldo_arrastre',
      monto_ajuste_centavos: 5000,
    });
    expect(() =>
      ajustes.consumir('aj-2', { montoCompensado: 5001, compensadoEn: '2026-12-20T00:00:00.000Z' }),
    ).toThrow();
  });

  it('Dado restos de absorción parcial cuando listarSaldosArrastre Entonces enfrento el resto por origen; absorción completa no lista nada', () => {
    insertarCabecera(db, { id: 'liq-conf', estado: 'confirmada', items: 10000, total: 10000 });
    insertarItem(db, { id: 'it-1', liquidacion_id: 'liq-conf', pago_id: 'pag-1' });
    ajustes.insertarReservado({
      id: 'aj-1',
      liquidacion_id: 'liq-conf',
      item_origen_id: 'it-1',
      pago_id: 'pag-1',
      tipo_ajuste: 'anulacion_cobro',
      monto_ajuste_centavos: 20000,
    });
    ajustes.consumir('aj-1', { montoCompensado: 15000, compensadoEn: '2026-11-20T00:00:00.000Z' });
    expect(
      ajustes.listarSaldosArrastre('prof-1').map((s) => ({
        item_origen_id: s.item_origen_id,
        resto_centavos: s.resto_centavos,
      })),
    ).toEqual([{ item_origen_id: 'it-1', resto_centavos: 5000 }]);
    expect(ajustes.listarAnulacionesSinReserva('prof-1')).toHaveLength(0);
  });

  it('Dado anulaciones de una liquidación confirmada Cuando pago queda anulado sin reserva activa Entonces pendiente detectado; no cruza profesionales ni incluye borradores', () => {
    insertarCabecera(db, { id: 'liq-conf', estado: 'confirmada', items: 20000, total: 20000 });
    insertarPago(db, {
      id: 'pag-orig',
      turnoId: 'tur-1',
      presupuestoId: null,
      estado: 'anulado',
      anuladoEn: '2026-11-20T00:00:00.000Z',
    });
    insertarItem(db, { id: 'it-1', liquidacion_id: 'liq-conf', pago_id: 'pag-orig' });
    const pendientes = ajustes.listarAnulacionesSinReserva('prof-1');
    expect(pendientes).toEqual([
      {
        item_origen_id: 'it-1',
        pago_id: 'pag-orig',
        monto_comision_original_centavos: 20000,
        anulado_en: '2026-11-20T00:00:00.000Z',
      },
    ]);
    expect(ajustes.listarAnulacionesSinReserva('prof-2')).toEqual([]);
    insertarCabecera(db, { id: 'liq-2', desde: '2026-12-01T00:00:00.000Z', hasta: '2026-12-31T00:00:00.000Z' });
    ajustes.insertarReservado({
      id: 'aj-1',
      liquidacion_id: 'liq-2',
      item_origen_id: 'it-1',
      pago_id: 'pag-orig',
      tipo_ajuste: 'anulacion_cobro',
      monto_ajuste_centavos: 20000,
    });
    expect(ajustes.listarAnulacionesSinReserva('prof-1')).toEqual([]);
  });

  it('Dado pago anulado de liquidación confirmada con ajuste ya CONSUMIDO parcialmente Cuando detecto pendientes Entonces NO se re-reporta la anulación (sin doble conteo D12) y el resto queda solo en arrastre', () => {
    insertarCabecera(db, { id: 'liq-conf2', estado: 'confirmada', items: 20000, total: 20000 });
    insertarPago(db, {
      id: 'pag-anulado',
      turnoId: 'tur-1',
      presupuestoId: null,
      estado: 'anulado',
      anuladoEn: '2026-11-20T00:00:00.000Z',
    });
    insertarItem(db, { id: 'it-2', liquidacion_id: 'liq-conf2', pago_id: 'pag-anulado' });
    // Absorción PARCIAL en la cabecera del período siguiente: 10000 de 20000.
    insertarCabecera(db, { id: 'liq-2', desde: '2026-12-01T00:00:00.000Z', hasta: '2026-12-31T00:00:00.000Z' });
    ajustes.insertarReservado({
      id: 'aj-1',
      liquidacion_id: 'liq-2',
      item_origen_id: 'it-2',
      pago_id: 'pag-anulado',
      tipo_ajuste: 'anulacion_cobro',
      monto_ajuste_centavos: 20000,
    });
    expect(
      ajustes.consumir('aj-1', { montoCompensado: 10000, compensadoEn: '2026-12-20T00:00:00.000Z' }),
    ).toBe(true);
    // La fila `consumido` ya representa la trayectoria del ajuste: la
    // detección (a) NO debe re-reportar la anulación (el LEFT JOIN excluye
    // CUALQUIER fila vigente, no solo `reservado`); el resto lo reporta (b).
    expect(ajustes.listarAnulacionesSinReserva('prof-1')).toEqual([]);
    expect(ajustes.listarAnulacionesSinReserva('prof-2')).toEqual([]);
    expect(ajustes.listarSaldosArrastre('prof-1')).toEqual([
      {
        item_origen_id: 'it-2',
        pago_id: 'pag-anulado',
        resto_centavos: 10000,
        primer_anulado_en: '2026-11-20T00:00:00.000Z',
      },
    ]);
    expect(ajustes.listarSaldosArrastre('prof-2')).toEqual([]);
  });
});

describe('pago.repository.listarCobrosElegiblesComision (C-13, tasks 3.3 / D2)', () => {
  let db: DatabaseSync;
  let pagos: PagoRepository;

  beforeEach(() => {
    db = openDatabase(':memory:');
    sembrarEntidadesBase(db);
    db.prepare(
      `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, prestacion_id, inicio, fin, estado, origen, created_at, updated_at) VALUES
         ('tur-otro-prof', 'prof-2', 'sil-1', 'pac-1', 'pres-1', '2026-11-04T10:00:00.000Z', '2026-11-04T10:30:00.000Z', 'atendido', 'recepcion', ?, ?),
         ('tur-no-atentido', 'prof-1', 'sil-1', 'pac-1', 'pres-1', '2026-11-06T10:00:00.000Z', '2026-11-06T10:30:00.000Z', 'confirmado', 'recepcion', ?, ?)`,
    ).run(AHORA, AHORA, AHORA, AHORA);
    insertarPresupuesto(db, { id: 'pre-1', turnoId: 'tur-1' });
    insertarPresupuesto(db, { id: 'pre-2', turnoId: 'tur-2' });
    insertarPresupuesto(db, { id: 'pre-3', turnoId: 'tur-2' });
    insertarPresupuesto(db, { id: 'pre-4', turnoId: 'tur-otro-prof' });
    insertarPresupuesto(db, { id: 'pre-5', turnoId: null });
    insertarPago(db, { id: 'pag-a', turnoId: 'tur-1', presupuestoId: null, createdAt: '2026-12-25T10:00:00.000Z' });
    insertarMovimiento(db, { id: 'mc-a', pagoId: 'pag-a', fecha: '2026-11-10' });
    insertarPago(db, { id: 'pag-b', turnoId: 'tur-1', presupuestoId: null, estado: 'pendiente' });
    insertarMovimiento(db, { id: 'mc-b', pagoId: 'pag-b', fecha: '2026-11-02' });
    insertarPago(db, {
      id: 'pag-c',
      turnoId: 'tur-1',
      presupuestoId: null,
      estado: 'anulado',
      anuladoEn: '2026-11-06T00:00:00.000Z',
    });
    insertarPago(db, { id: 'pag-d', turnoId: 'tur-1', presupuestoId: null, medio: 'obra_social' });
    insertarPago(db, { id: 'pag-e', turnoId: 'tur-1', presupuestoId: null });
    insertarMovimiento(db, { id: 'mc-e', pagoId: 'pag-e', fecha: '2026-12-02' });
    insertarPago(db, { id: 'pag-f', turnoId: null, presupuestoId: 'pre-1' });
    insertarPago(db, { id: 'pag-g', turnoId: null, presupuestoId: 'pre-4' });
    insertarPago(db, { id: 'pag-h', turnoId: null, presupuestoId: 'pre-5' });
    insertarPago(db, { id: 'pag-i', turnoId: 'tur-2', presupuestoId: 'pre-2' });
    insertarPago(db, { id: 'pag-j', turnoId: 'tur-1', presupuestoId: 'pre-3' });
    insertarPago(db, { id: 'pag-k', turnoId: 'tur-no-atentido', presupuestoId: null });
    insertarPago(db, { id: 'pag-l', turnoId: 'tur-2', presupuestoId: null, createdAt: '2026-11-15T09:00:00.000Z' });
    pagos = new PagoRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('Dado pagos sembrados del período 2026-11 Cuando listarCobrosElegiblesComision Entonces devuelve SOLO cobrados de bolsillo con fecha contable en rango, en orden canon por pago_id', () => {
    const filas = pagos.listarCobrosElegiblesComision('prof-1', '2026-11-01', '2026-11-30');
    expect(filas.map((f) => f.pago_id)).toEqual([
      'pag-a',
      'pag-f',
      'pag-g',
      'pag-h',
      'pag-i',
      'pag-j',
      'pag-k',
      'pag-l',
    ]);
  });

  it('Dado pago cobrado por turno con movimiento Cuando consulto Entonces fila elegible con fecha contable del movimiento de caja (Q3 gana al fallback), turno y prestación del turno', () => {
    const filas = pagos.listarCobrosElegiblesComision('prof-1', '2026-11-01', '2026-11-30');
    const fila = filas.find((f) => f.pago_id === 'pag-a')!;
    expect(fila).toEqual({
      pago_id: 'pag-a',
      monto_centavos: 100000,
      medio: 'efectivo',
      turno_id: 'tur-1',
      prestacion_id: 'pres-1',
      aplicacion: 'turno',
      fecha_contable: '2026-11-10',
      motivo_descarte: null,
    });
  });

  it('Dado pago por presupuesto con turno del profesional atendido y sin turno del pago Cuando consulto Entonces elegible con aplicacion presupuesto y turno del presupuesto (rama P1/D2)', () => {
    const filas = pagos.listarCobrosElegiblesComision('prof-1', '2026-11-01', '2026-11-30');
    const fila = filas.find((f) => f.pago_id === 'pag-f')!;
    expect(fila.turno_id).toBe('tur-1');
    expect(fila.aplicacion).toBe('presupuesto');
    expect(fila.motivo_descarte).toBeNull();
  });

  it('Dado doble referencia compatible (presupuesto.turno_id = pago.turno_id) Cuando consulto Entonces UNA SOLA fila, aplicacion turno, presupuesto no se re-procesa (D2)', () => {
    const filas = pagos.listarCobrosElegiblesComision('prof-1', '2026-11-01', '2026-11-30');
    const coincidencias = filas.filter((f) => f.pago_id === 'pag-i');
    expect(coincidencias).toHaveLength(1);
    expect(coincidencias[0].turno_id).toBe('tur-2');
    expect(coincidencias[0].prestacion_id).toBe('pres-2');
    expect(coincidencias[0].aplicacion).toBe('turno');
    expect(coincidencias[0].motivo_descarte).toBeNull();
  });

  it('Dado doble referencia incompatible (presupuesto.turno_id distinto del pago) Cuando consulto Entonces fila EXCLUIDA con motivo explícito consultable (D2)', () => {
    const filas = pagos.listarCobrosElegiblesComision('prof-1', '2026-11-01', '2026-11-30');
    const fila = filas.find((f) => f.pago_id === 'pag-j')!;
    expect(fila.motivo_descarte).toBe('doble_referencia_incompatible');
  });

  it('Dado presupuesto con turno de otro profesional o sin turno Cuando consulto Entonces motivo no_atribuible (sin heurística, D2)', () => {
    const filas = pagos.listarCobrosElegiblesComision('prof-1', '2026-11-01', '2026-11-30');
    expect(filas.find((f) => f.pago_id === 'pag-g')!.motivo_descarte).toBe('no_atribuible');
    expect(filas.find((f) => f.pago_id === 'pag-h')!.motivo_descarte).toBe('no_atribuible');
  });

  it('Dado turno del pago no atendido Cuando consulto Entonces motivo turno_no_atendido (Q2); turno dado de baja también queda fuera', () => {
    const filas = pagos.listarCobrosElegiblesComision('prof-1', '2026-11-01', '2026-11-30');
    expect(filas.find((f) => f.pago_id === 'pag-k')!.motivo_descarte).toBe('turno_no_atendido');
    db.prepare(`UPDATE turno SET deleted_at = ? WHERE id = 'tur-2'`).run(AHORA);
    const filasTrasBaja = pagos.listarCobrosElegiblesComision('prof-1', '2026-11-01', '2026-11-30');
    const pagL = filasTrasBaja.find((f) => f.pago_id === 'pag-l')!;
    expect(pagL.motivo_descarte).toBe('turno_no_atendido');
    const pagI = filasTrasBaja.find((f) => f.pago_id === 'pag-i')!;
    expect(pagI.motivo_descarte).toBe('turno_no_atendido');
  });

  it('Dado pago sin movimiento de caja Cuando consulto Entonces fallback documentado: fecha contable = substr(pago.created_at) (D3)', () => {
    const filas = pagos.listarCobrosElegiblesComision('prof-1', '2026-11-01', '2026-11-30');
    const fila = filas.find((f) => f.pago_id === 'pag-l')!;
    expect(fila.fecha_contable).toBe('2026-11-15');
    expect(fila.motivo_descarte).toBeNull();
  });

  it('Dado un profesional Cuando otra consulta Entonces cada consulta reporta con el profesional correcto (scoping por parámetro, sin fugas)', () => {
    const filas = pagos.listarCobrosElegiblesComision('prof-2', '2026-11-01', '2026-11-30');
    const filaJ = filas.find((f) => f.pago_id === 'pag-j')!;
    expect(filaJ.motivo_descarte).toBe('doble_referencia_incompatible');
    const filaF = filas.find((f) => f.pago_id === 'pag-f')!;
    expect(filaF.motivo_descarte).toBe('no_atribuible');
  });
});
