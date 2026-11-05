/**
 * Task 4.1: Mercado Pago (C-11, design D7) — confirmación en dos etapas.
 * El proveedor se simula EXACTAMENTE en el límite de la interfaz
 * `MercadoPagoProveedor` (R12: la capa de transacción sigue siendo SQLite
 * real). Verifica: intención pendiente sin movimiento, vínculo local ANTES
 * del proveedor, firma HMAC del webhook ANTES de consultar, verificación
 * directa con contraste exacto, transición con relectura (pendiente→cobrado
 * con movimiento; cobrado→idempotente sin doble movimiento; anulado→409) y
 * errores tipados sin PHI (R3).
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import type { DatabaseSync } from 'node:sqlite';
import { PagoRepository } from '../src/core/pago.repository.js';
import { CajaError } from '../src/shared/errors.js';
import {
  MpPagoInexistenteProveedorError,
  MpProveedorError,
  type MercadoPagoProveedor,
  type PagoVerificadoMp,
  type ReferenciaPagoMp,
} from '../src/caja/mercadopago/index.js';
import {
  diaContableHoy,
  movimientosDePago,
  seedCajaBase,
  servicioCaja,
} from './helpers/caja-fixtures.js';

const SECRETO_WEBHOOK = 'secreto-webhook-ejemplo-c11';
const TS_NOTIFICACION = '1719033200';

/** Fake de proveedor: estado controlado + contadores de llamadas (límite de interfaz). */
class FakeProveedorMp implements MercadoPagoProveedor {
  intenciones = 0;
  consultas = 0;
  private pagos = new Map<string, PagoVerificadoMp>();
  errorIntencion: unknown = null;
  errorConsulta: unknown = null;

  crearIntencion(intencion: { pagoId: string; montoCentavos: number }): ReferenciaPagoMp {
    this.intenciones += 1;
    if (this.errorIntencion !== null) throw this.errorIntencion;
    return {
      paymentId: `sbx-pay-${this.intenciones}`,
      externalReference: `mp-sandbox:pago=${intencion.pagoId}`,
    };
  }

  registrarPago(verificado: PagoVerificadoMp): void {
    this.pagos.set(verificado.paymentId, verificado);
  }

  consultarPago(paymentId: string): PagoVerificadoMp {
    this.consultas += 1;
    if (this.errorConsulta !== null) throw this.errorConsulta;
    const verificado = this.pagos.get(paymentId);
    if (verificado === undefined) {
      throw new MpPagoInexistenteProveedorError('pago inexistente en la API del proveedor');
    }
    return verificado;
  }
}

/** Firma v1 válida según el manifest oficial (HMAC-SHA256 del secreto). */
function firmaValida(paymentId: string, requestId: string, ts = TS_NOTIFICACION): string {
  const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;
  return `ts=${ts},v1=${createHmac('sha256', SECRETO_WEBHOOK).update(manifest).digest('hex')}`;
}

function capturar(fn: () => unknown): CajaError {
  try {
    fn();
  } catch (err) {
    if (err instanceof CajaError) return err;
    throw err;
  }
  throw new Error('la operación debería haber fallado con CajaError');
}

/** Pago MP pendiente con sus vínculos estructurados. */
interface PendienteMp {
  readonly db: DatabaseSync;
  readonly mp: FakeProveedorMp;
  readonly pagoId: string;
  readonly paymentId: string;
  readonly externalReference: string;
  readonly montoCentavos: number;
}

/** Crea un cobro MP pendiente real (repositorio) con el fake provisto. */
function crearPendienteMp(db: DatabaseSync, montoCentavos: number): PendienteMp {
  const mp = new FakeProveedorMp();
  const service = servicioCaja(db, { mp: mpOpciones(mp) });
  const resultado = service.registrarCobro({
    montoCentavos,
    medio: 'mercadopago',
    turnoId: 'turno-caja',
    actorUsuarioId: 'user-caja',
  });
  const link = JSON.parse(resultado.pago.referencia ?? '{}') as ReferenciaPagoMp;
  return {
    db,
    mp,
    pagoId: resultado.pago.id,
    paymentId: link.paymentId,
    externalReference: link.externalReference,
    montoCentavos,
  };
}

/** Registra en el fake la respuesta del proveedor para el pago del pendiente. */
function aprobarEnProveedor(
  pendiente: PendienteMp,
  patch: Partial<PagoVerificadoMp> = {},
): void {
  pendiente.mp.registrarPago({
    paymentId: pendiente.paymentId,
    estado: 'approved',
    montoCentavos: pendiente.montoCentavos,
    moneda: 'ARS',
    externalReference: pendiente.externalReference,
    ...patch,
  });
}

/** Servicio ligado al fake del pendiente (misma instancia). */
function servicioDe(pendiente: PendienteMp): ReturnType<typeof servicioCaja> {
  return servicioCaja(pendiente.db, {
    mp: { proveedor: pendiente.mp, webhookSecret: SECRETO_WEBHOOK },
  });
}

/** Opciones de integración MP para `servicioCaja`. */
function mpOpciones(mp: FakeProveedorMp): {
  proveedor: MercadoPagoProveedor;
  webhookSecret: string;
} {
  return { proveedor: mp, webhookSecret: SECRETO_WEBHOOK };
}

describe('Intención de pago MP (sandbox)', () => {
  it('Dado MP configurado Cuando registro un cobro mercadopago Entonces queda pendiente con referencia estructurada y SIN movimiento de caja (D7: se crea al confirmar)', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const mp = new FakeProveedorMp();
    const service = servicioCaja(db, { mp: mpOpciones(mp) });

    const resultado = service.registrarCobro({
      montoCentavos: 22000,
      medio: 'mercadopago',
      turnoId: 'turno-caja',
      actorUsuarioId: 'user-caja',
    });

    expect(mp.intenciones).toBe(1);
    expect(resultado.pago.estado).toBe('pendiente');
    expect(resultado.pago.medio).toBe('mercadopago');
    const link = JSON.parse(resultado.pago.referencia ?? '{}') as ReferenciaPagoMp;
    expect(link.paymentId).toBe('sbx-pay-1');
    expect(link.externalReference).toBe(`mp-sandbox:pago=${resultado.pago.id}`);
    expect(movimientosDePago(db, resultado.pago.id)).toEqual([]);
    db.close();
  });

  it('Dado proveedor caído al crear la intención Cuando registro el cobro Entonces 502 mp_error_proveedor y la transacción completa se descarta (no persiste el pago)', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const mp = new FakeProveedorMp();
    mp.errorIntencion = new MpProveedorError('caída del proveedor');
    const service = servicioCaja(db, { mp: mpOpciones(mp) });

    const err = capturar(() =>
      service.registrarCobro({
        montoCentavos: 22000,
        medio: 'mercadopago',
        turnoId: 'turno-caja',
        actorUsuarioId: 'user-caja',
      }),
    );
    expect(err.status).toBe(502);
    expect(err.code).toBe('mp_error_proveedor');
    const n = db.prepare('SELECT COUNT(*) AS n FROM pago').get() as { n: number };
    expect(n.n).toBe(0);
    db.close();
  });

  it('Dado MP sin configurar Cuando registro un cobro mercadopago o confirmo Entonces 503 mp_no_configurado (sin defaults silenciosos)', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const service = servicioCaja(db); // sin opciones mp

    expect(
      capturar(() =>
        service.registrarCobro({
          montoCentavos: 1000,
          medio: 'mercadopago',
          turnoId: 'turno-caja',
          actorUsuarioId: 'user-caja',
        }),
      ).code,
    ).toBe('mp_no_configurado');
    expect(
      capturar(() =>
        service.confirmarPagoMp({
          pagoId: 'pago-quimera',
          paymentId: 'sbx-pay-x',
          signatureHeader: `ts=${TS_NOTIFICACION},v1=${'a'.repeat(64)}`,
          requestId: 'req-1',
          actorUsuarioId: 'user-caja',
        }),
      ).status,
    ).toBe(503);
    db.close();
  });
});

describe('Confirmación MP en dos etapas (design D7)', () => {
  it('Dado pago pendiente con aprobación verificada y firma válida Cuando confirmo Entonces transición a cobrado con movimiento del día; repetir la confirmación es idempotente sin doble movimiento', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const pendiente = crearPendienteMp(db, 22000);
    aprobarEnProveedor(pendiente);
    const service = servicioDe(pendiente);

    const confirmado = service.confirmarPagoMp({
      pagoId: pendiente.pagoId,
      paymentId: pendiente.paymentId,
      signatureHeader: firmaValida(pendiente.paymentId, 'req-1'),
      requestId: 'req-1',
      actorUsuarioId: 'user-caja',
    });
    expect(confirmado.estado).toBe('cobrado');
    expect(movimientosDePago(db, pendiente.pagoId)).toEqual([
      {
        tipo: 'cobro',
        monto_centavos: 22000,
        aplicado_en: diaContableHoy(),
        motivo_asignacion: null,
      },
    ]);
    expect(pendiente.mp.consultas).toBe(1);

    // replay: idempotente, sin doble movimiento
    const deNuevo = service.confirmarPagoMp({
      pagoId: pendiente.pagoId,
      paymentId: pendiente.paymentId,
      signatureHeader: firmaValida(pendiente.paymentId, 'req-1'),
      requestId: 'req-1',
      actorUsuarioId: 'user-caja',
    });
    expect(deNuevo.estado).toBe('cobrado');
    expect(deNuevo.id).toBe(pendiente.pagoId);
    expect(movimientosDePago(db, pendiente.pagoId)).toHaveLength(1);
    db.close();
  });

  it('Dado firma inválida, pago local inexistente o data.id no vinculado Cuando confirmo Entonces 401/404 SIN consultar al proveedor (contador 0) manteniendo el estado pendiente (R2)', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const pendiente = crearPendienteMp(db, 22000);
    aprobarEnProveedor(pendiente);
    const service = servicioDe(pendiente);

    // firma bien formada pero HMAC equivocado → 401
    const err401 = capturar(() =>
      service.confirmarPagoMp({
        pagoId: pendiente.pagoId,
        paymentId: pendiente.paymentId,
        signatureHeader: `ts=${TS_NOTIFICACION},v1=${'f'.repeat(64)}`,
        requestId: 'req-1',
        actorUsuarioId: 'user-caja',
      }),
    );
    expect(err401.status).toBe(401);
    expect(err401.code).toBe('mp_firma_invalida');

    // pago local inexistente → 404
    expect(
      capturar(() =>
        service.confirmarPagoMp({
          pagoId: 'pago-quimera',
          paymentId: pendiente.paymentId,
          signatureHeader: firmaValida(pendiente.paymentId, 'req-1'),
          requestId: 'req-1',
          actorUsuarioId: 'user-caja',
        }),
      ).status,
    ).toBe(404);

    // data.id no vinculado a la referencia del pago local → 404
    expect(
      capturar(() =>
        service.confirmarPagoMp({
          pagoId: pendiente.pagoId,
          paymentId: 'sbx-otro-pago',
          signatureHeader: firmaValida('sbx-otro-pago', 'req-1'),
          requestId: 'req-1',
          actorUsuarioId: 'user-caja',
        }),
      ).code,
    ).toBe('mp_pago_inexistente');

    expect(pendiente.mp.consultas).toBe(0); // nada consultó al proveedor
    const pago = new PagoRepository(db).findById(pendiente.pagoId);
    expect(pago?.estado).toBe('pendiente');
    expect(pago?.monto_centavos).toBe(22000);
    db.close();
  });

  it('Dado pago no aprobado en el proveedor Cuando confirmo Entonces 422 mp_pago_no_aprobado y queda pendiente sin movimiento', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const pendiente = crearPendienteMp(db, 10000);
    aprobarEnProveedor(pendiente, { estado: 'rejected' });
    const service = servicioDe(pendiente);

    const err = capturar(() =>
      service.confirmarPagoMp({
        pagoId: pendiente.pagoId,
        paymentId: pendiente.paymentId,
        signatureHeader: firmaValida(pendiente.paymentId, 'req-2'),
        requestId: 'req-2',
        actorUsuarioId: 'user-caja',
      }),
    );
    expect(err.status).toBe(422);
    expect(err.code).toBe('mp_pago_no_aprobado');
    expect(new PagoRepository(db).findById(pendiente.pagoId)?.estado).toBe('pendiente');
    expect(movimientosDePago(db, pendiente.pagoId)).toEqual([]);
    db.close();
  });

  it('Dado monto, external_reference o moneda incongruentes en el proveedor Cuando confirmo Entonces 422 mp_datos_incongruentes en cada caso y todo queda pendiente', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const pendientes = {
      monto: crearPendienteMp(db, 15000),
      referencia: crearPendienteMp(db, 3000),
      moneda: crearPendienteMp(db, 5000),
    };

    aprobarEnProveedor(pendientes.monto, { montoCentavos: 15001 });
    aprobarEnProveedor(pendientes.referencia, {
      externalReference: 'mp-sandbox:otra-coincidencia',
    });
    aprobarEnProveedor(pendientes.moneda, { moneda: 'USD' });

    const casos = [
      { pendiente: pendientes.monto, rotulo: 'req-3' },
      { pendiente: pendientes.referencia, rotulo: 'req-4' },
      { pendiente: pendientes.moneda, rotulo: 'req-5' },
    ] as const;
    for (const caso of casos) {
      const service = servicioDe(caso.pendiente);
      expect(
        capturar(() =>
          service.confirmarPagoMp({
            pagoId: caso.pendiente.pagoId,
            paymentId: caso.pendiente.paymentId,
            signatureHeader: firmaValida(caso.pendiente.paymentId, caso.rotulo),
            requestId: caso.rotulo,
            actorUsuarioId: 'user-caja',
          }),
        ).code,
      ).toBe('mp_datos_incongruentes');
    }

    for (const pendiente of Object.values(pendientes)) {
      expect(new PagoRepository(db).findById(pendiente.pagoId)?.estado).toBe('pendiente');
      expect(movimientosDePago(db, pendiente.pagoId)).toEqual([]);
    }
    db.close();
  });

  it('Dado un pago que el proveedor no conoce Cuando confirmo Entonces 422 mp_pago_no_verificado y queda pendiente', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const pendiente = crearPendienteMp(db, 8000);
    const service = servicioDe(pendiente);

    const err = capturar(() =>
      service.confirmarPagoMp({
        pagoId: pendiente.pagoId,
        paymentId: pendiente.paymentId,
        signatureHeader: firmaValida(pendiente.paymentId, 'req-6'),
        requestId: 'req-6',
        actorUsuarioId: 'user-caja',
      }),
    );
    expect(err.status).toBe(422);
    expect(err.code).toBe('mp_pago_no_verificado');
    // la consulta llegó al proveedor exactamente una vez y falló ahí
    expect(pendiente.mp.consultas).toBe(1);
    expect(new PagoRepository(db).findById(pendiente.pagoId)?.estado).toBe('pendiente');
    db.close();
  });

  it('Dado un proveedor caído en la verificación directa Cuando confirmo Entonces 502 mp_error_proveedor sin alterar el estado local', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const pendiente = crearPendienteMp(db, 9000);
    aprobarEnProveedor(pendiente);
    pendiente.mp.errorConsulta = new MpProveedorError('timeout del proveedor');
    const service = servicioDe(pendiente);

    const err = capturar(() =>
      service.confirmarPagoMp({
        pagoId: pendiente.pagoId,
        paymentId: pendiente.paymentId,
        signatureHeader: firmaValida(pendiente.paymentId, 'req-7'),
        requestId: 'req-7',
        actorUsuarioId: 'user-caja',
      }),
    );
    expect(err.status).toBe(502);
    expect(err.code).toBe('mp_error_proveedor');
    expect(new PagoRepository(db).findById(pendiente.pagoId)?.estado).toBe('pendiente');
    db.close();
  });

  it('Dado un pago ya anulado Cuando confirmo Entonces 409 mp_transicion_invalida y sigue anulado (sin movimiento)', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const pendiente = crearPendienteMp(db, 12000);
    aprobarEnProveedor(pendiente);
    const service = servicioDe(pendiente);
    // transición manual fuera de caja (fixture): pendiente → anulado
    db.prepare(`UPDATE pago SET estado = 'anulado' WHERE id = ?`).run(pendiente.pagoId);

    const err = capturar(() =>
      service.confirmarPagoMp({
        pagoId: pendiente.pagoId,
        paymentId: pendiente.paymentId,
        signatureHeader: firmaValida(pendiente.paymentId, 'req-8'),
        requestId: 'req-8',
        actorUsuarioId: 'user-caja',
      }),
    );
    expect(err.status).toBe(409);
    expect(err.code).toBe('mp_transicion_invalida');
    expect(new PagoRepository(db).findById(pendiente.pagoId)?.estado).toBe('anulado');
    expect(movimientosDePago(db, pendiente.pagoId)).toEqual([]);
    db.close();
  });

  it('Dado la caja de hoy ya cerrada Cuando confirma un pago MP aprobado Entonces 409 sin_caja_abierta_asignacion, la transacción entera se descarta y el pago sigue pendiente', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const pendiente = crearPendienteMp(db, 14000);
    aprobarEnProveedor(pendiente);
    const service = servicioDe(pendiente);
    service.cerrarCaja({ actorUsuarioId: 'user-caja' }); // cierra el día contable de hoy

    const err = capturar(() =>
      service.confirmarPagoMp({
        pagoId: pendiente.pagoId,
        paymentId: pendiente.paymentId,
        signatureHeader: firmaValida(pendiente.paymentId, 'req-9'),
        requestId: 'req-9',
        actorUsuarioId: 'user-caja',
      }),
    );
    expect(err.status).toBe(409);
    expect(err.code).toBe('sin_caja_abierta_asignacion');
    // rollback de la transacción: ni cobro ni movimiento
    expect(new PagoRepository(db).findById(pendiente.pagoId)?.estado).toBe('pendiente');
    expect(movimientosDePago(db, pendiente.pagoId)).toEqual([]);
    db.close();
  });

  it('Dado un pago soft-deleted Cuando confirman Entonces 404 mp_pago_inexistente sin consultar proveedor (vínculo local primero)', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const pendiente = crearPendienteMp(db, 6000);
    aprobarEnProveedor(pendiente);
    const service = servicioDe(pendiente);
    new PagoRepository(db).softDelete(pendiente.pagoId);

    const err = capturar(() =>
      service.confirmarPagoMp({
        pagoId: pendiente.pagoId,
        paymentId: pendiente.paymentId,
        signatureHeader: firmaValida(pendiente.paymentId, 'req-10'),
        requestId: 'req-10',
        actorUsuarioId: 'user-caja',
      }),
    );
    expect(err.status).toBe(404);
    expect(err.code).toBe('mp_pago_inexistente');
    expect(pendiente.mp.consultas).toBe(0);
    db.close();
  });
});
