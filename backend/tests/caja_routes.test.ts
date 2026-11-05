/**
 * Task 5.1/5.2: rutas HTTP de caja (C-11) — supertest como en
 * presupuestos_routes, con RBAC real vía JWT (requireAuth + requireRoles):
 * gestión (cobros/anular/historiales/saldo/deuda) para `recepcion` y
 * `administracion`; cierres, resumen, movimientos y confirmación MP solo
 * `administracion`; `profesional` → 403 en todo el dominio (R4).
 * Proveedor MP simulado en el límite de la interfaz (R12). SQLite real (R12).
 */
import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/shared/repository.js';
import { cajaRouter } from '../src/caja/caja.routes.js';
import { errorHandler } from '../src/shared/error-handler.js';
import { signToken } from '../src/auth/tokens.js';
import { loadConfig, type AppConfig } from '../src/shared/config.js';
import { MpProveedorError, type MercadoPagoProveedor, type PagoVerificadoMp, type ReferenciaPagoMp } from '../src/caja/mercadopago/index.js';
import type { Rol } from '../src/shared/types.js';
import {
  insertConcepto,
  seedCajaBase,
} from './helpers/caja-fixtures.js';

const JWT = 'test-secret-caja-routes-con-mas-de-32-caracteres';

/** Config con MP habilitado (token/secret ficticios, per R15). */
function configConMp(): AppConfig {
  return loadConfig({
    PORT: '3000',
    DATABASE_PATH: ':memory:',
    NODE_ENV: 'test',
    JWT_SECRET: JWT,
    CAJA_ZONA_HORARIA: 'America/Buenos_Aires',
    MP_ACCESS_TOKEN: 'TEST-token-ficticio-routes',
    MP_WEBHOOK_SECRET: 'secreto-webhook-ficticio-routes-c11',
  });
}

/** Config sin credenciales MP → integración deshabilitada. */
function configSinMp(): AppConfig {
  return loadConfig({
    PORT: '3000',
    DATABASE_PATH: ':memory:',
    NODE_ENV: 'test',
    JWT_SECRET: JWT,
  });
}

interface ConfirmacionProveedor {
  estado: string;
  montoCentavos: number;
}
function aprobarEnFake(
  fake: FakeCajaProveedorRoutes,
  paymentId: string,
  externalReference: string,
  montoCentavos: number,
  patch: Partial<ConfirmacionProveedor> = {},
): void {
  fake.registrar({
    paymentId,
    estado: patch.estado ?? 'approved',
    montoCentavos: patch.montoCentavos ?? montoCentavos,
    moneda: 'ARS',
    externalReference,
  });
}

/** Fake del proveedor MP con contador de consultas (límite de interfaz, R12). */
class FakeCajaProveedorRoutes implements MercadoPagoProveedor {
  consultas = 0;
  intenciones = 0;
  private pagos = new Map<string, PagoVerificadoMp>();

  crearIntencion(intencion: { pagoId: string; montoCentavos: number }): ReferenciaPagoMp {
    this.intenciones += 1;
    return {
      paymentId: `sbx-pay-routes-${this.intenciones}`,
      externalReference: `mp-sandbox:pago=${intencion.pagoId}`,
    };
  }

  registrar(verificado: PagoVerificadoMp): void {
    this.pagos.set(verificado.paymentId, verificado);
  }

  consultarPago(paymentId: string): PagoVerificadoMp {
    this.consultas += 1;
    const verificado = this.pagos.get(paymentId);
    if (verificado === undefined) {
      throw new MpProveedorError('pago no simulado para este test');
    }
    return verificado;
  }
}

/** Firma v1 del webhook: HMAC-SHA256 del manifest oficial. */
function firmaWebhook(
  paymentId: string,
  secreto: string,
  requestId = 'req-routes-1',
  ts = '1770000000',
): { xSignature: string; xRequestId: string } {
  const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac('sha256', secreto).update(manifest).digest('hex');
  return { xSignature: `ts=${ts},v1=${v1}`, xRequestId: requestId };
}

let db: DatabaseSync;

function crearApp(
  config: AppConfig = configConMp(),
  proveedor: MercadoPagoProveedor = new FakeCajaProveedorRoutes(),
): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api', cajaRouter(db, config, proveedor));
  app.use(errorHandler);
  return app;
}

function bearer(roles: readonly Rol[]): string {
  return `Bearer ${signToken(
    {
      sub: 'user-caja',
      tenantId: 'test',
      roles,
      email: 'caja@ficticio.test',
      type: 'access',
      ttlSeconds: 900,
    },
    configConMp().jwtSecret,
  )}`;
}

beforeEach(() => {
  db = openDatabase(':memory:');
  seedCajaBase(db);
  insertConcepto(db, {
    id: 'pres-routes-1',
    turnoId: 'turno-caja',
    totalCentavos: 100000,
    coberturaCentavos: 40000,
    saldoCentavos: 60000,
  });
});

afterEach(() => {
  db.close();
});

describe('RBAC y ciclo básico de cobros por HTTP (C-11)', () => {
  it('Dado recepcion Cuando POST /api/pagos con cobro válido Entonces 201 cobrado; el payload recortado respeta el esquema de la vista', async () => {
    const res = await request(crearApp())
      .post('/api/pagos')
      .set('Authorization', bearer(['recepcion']))
      .send({
        monto_centavos: 25000,
        medio: 'efectivo',
        presupuesto_id: 'pres-routes-1',
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      monto_centavos: 25000,
      moneda: 'ARS',
      medio: 'efectivo',
      estado: 'cobrado',
      presupuesto_id: 'pres-routes-1',
      actor_usuario_id: 'user-caja',
    });
  });

  it('Dado profesional Cuando operó cualquier ruta de caja Entonces 403 forbidden', async () => {
    const app = crearApp();
    for (const [metodo, ruta] of [
      ['post', '/api/pagos'],
      ['get', '/api/turnos/turno-caja/saldo'],
      ['get', '/api/turnos/turno-caja/pagos'],
      ['get', '/api/pacientes/pac-caja/deuda'],
      ['post', '/api/caja/cierres'],
      ['get', '/api/caja/cierres'],
      ['get', '/api/caja/resumen?fecha=2026-06-01'],
      ['get', '/api/caja/movimientos?fecha=2026-06-01'],
    ] as const) {
      const res = await request(app)[metodo](ruta).set('Authorization', bearer(['profesional']));
      expect(res.status, ruta).toBe(403);
      expect(res.body).toEqual({ error: 'forbidden' });
    }
    const resAnular = await request(app)
      .post('/api/pagos/pago-x/anular')
      .set('Authorization', bearer(['profesional']))
      .send({ motivo: 'x' });
    expect(resAnular.status).toBe(403);
  });

  it('Dado usuario no autenticado Cuando llama a /api/pagos Entonces 401 no_autenticado', async () => {
    const res = await request(crearApp()).post('/api/pagos').send({});
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'no_autenticado' });
  });

  it('Dado un turno sin conceptos aceptados Cuando recepcion registra cobro directo Entonces queda cobrado con aplicación por turno (y un turno CON concepto rechaza el directo con 422)', async () => {
    // turno auxiliar sin concepto (el seed de beforeEach da a turno-caja un concepto aceptado)
    db.prepare(
      `INSERT INTO paciente (id, nombre, obra_social_plan_id, activo, created_at, updated_at)
       VALUES ('pac-libre', 'Paciente Libre Ficticio', NULL, 1, datetime('now'), datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at)
       VALUES ('turno-libre', 'prof-caja', 'sillon-caja', 'pac-libre',
               '2026-11-04T10:00:00.000Z', '2026-11-04T10:30:00.000Z',
               'confirmado', 'recepcion', datetime('now'), datetime('now'))`,
    ).run();

    const res = await request(crearApp())
      .post('/api/pagos')
      .set('Authorization', bearer(['recepcion']))
      .send({
        monto_centavos: 5000,
        medio: 'tarjeta',
        turno_id: 'turno-libre',
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ estado: 'cobrado', turno_id: 'turno-libre', presupuesto_id: null });

    // el turno con concepto aceptado NO admite cobro directo (sin doble contabilidad)
    const rechazo = await request(crearApp())
      .post('/api/pagos')
      .set('Authorization', bearer(['recepcion']))
      .send({
        monto_centavos: 1000,
        medio: 'efectivo',
        turno_id: 'turno-caja',
      });
    expect(rechazo.status).toBe(422);
    expect(rechazo.body.error).toBe('aplicacion_requerida');
  });

  it('Dado cuerpos inválidos Entonces 400 validacion con detalle; presupuesto no aceptado Entonces 422 aplicacion_requerida; exceso Entonces 422 monto_excede_saldo', async () => {
    const app = crearApp();
    const auth = { Authorization: bearer(['recepcion']) };

    const montoRoto = await request(app).post('/api/pagos').set(auth).send({
      monto_centavos: 'diez',
      medio: 'efectivo',
      presupuesto_id: 'pres-routes-1',
    });
    expect(montoRoto.status).toBe(400);
    expect(montoRoto.body.error).toBe('validacion');
    expect(montoRoto.body.detalle).toBeDefined();

    const medioRoto = await request(app).post('/api/pagos').set(auth).send({
      monto_centavos: 1000,
      medio: 'bitcoin',
      turno_id: 'turno-caja',
    });
    expect(medioRoto.status).toBe(400);

    const sinAplicacion = await request(app).post('/api/pagos').set(auth).send({
      monto_centavos: 1000,
      medio: 'efectivo',
    });
    expect(sinAplicacion.status).toBe(400);

    const borrador = async (): Promise<unknown> => {
      insertConcepto(db, {
        id: 'pres-routes-borrador',
        turnoId: 'turno-caja',
        estado: 'borrador',
        totalCentavos: 100000,
        coberturaCentavos: 0,
        saldoCentavos: 100000,
      });
      return null;
    };
    await borrador();
    const noAceptado = await request(app).post('/api/pagos').set(auth).send({
      monto_centavos: 1000,
      medio: 'efectivo',
      presupuesto_id: 'pres-routes-borrador',
    });
    expect(noAceptado.status).toBe(422);
    expect(noAceptado.body.error).toBe('aplicacion_requerida');

    const excede = await request(app).post('/api/pagos').set(auth).send({
      monto_centavos: 200000,
      medio: 'efectivo',
      presupuesto_id: 'pres-routes-1',
    });
    expect(excede.status).toBe(422);
    expect(excede.body.error).toBe('monto_excede_saldo');
  });

  it('Dado anulación por HTTP Cuando POST /api/pagos/:id/anular Entonces 200 anulado; repetida → 409; pago inexistente → 404', async () => {
    const app = crearApp();
    const auth = { Authorization: bearer(['recepcion']) };
    const cobro = await request(app).post('/api/pagos').set(auth).send({
      monto_centavos: 15000,
      medio: 'efectivo',
      presupuesto_id: 'pres-routes-1',
    });
    expect(cobro.status).toBe(201);
    const pagoId = cobro.body.id as string;

    const anulada = await request(app)
      .post(`/api/pagos/${pagoId}/anular`)
      .set(auth)
      .send({ motivo: 'carga duplicada ficticia' });
    expect(anulada.status).toBe(200);
    expect(anulada.body.estado).toBe('anulado');
    expect(anulada.body.motivo_anulacion).toBe('carga duplicada ficticia');

    const otraVez = await request(app)
      .post(`/api/pagos/${pagoId}/anular`)
      .set(auth)
      .send({ motivo: 'otra vez' });
    expect(otraVez.status).toBe(409);
    expect(otraVez.body.error).toBe('anulacion_inconsistente');

    const inexistente = await request(app)
      .post('/api/pagos/pago-quimera/anular')
      .set(auth)
      .send({ motivo: 'x' });
    expect(inexistente.status).toBe(404);

    const sinMotivo = await request(app)
      .post(`/api/pagos/${pagoId}/anular`)
      .set(auth)
      .send({});
    expect(sinMotivo.status).toBe(400);
  });

  it('Dado consultas de saldo, deuda e historial Cuando GET Entonces 200 con las vistas; turno inexistente → 404 no encontrado', async () => {
    const app = crearApp();
    const auth = { Authorization: bearer(['recepcion']) };
    await request(app).post('/api/pagos').set(auth).send({
      monto_centavos: 20000,
      medio: 'transferencia',
      presupuesto_id: 'pres-routes-1',
    });

    const saldo = await request(app)
      .get('/api/turnos/turno-caja/saldo')
      .set(auth);
    expect(saldo.status).toBe(200);
    expect(saldo.body).toMatchObject({
      turno_id: 'turno-caja',
      total_a_cobrar: 60000,
      saldo_restante: 40000,
      cobrado_ars: 20000,
      cobrado_obra_social: 0,
    });

    const historia = await request(app)
      .get('/api/turnos/turno-caja/pagos')
      .set(auth);
    expect(historia.status).toBe(200);
    expect(historia.body).toHaveLength(1);

    const concepto = await request(app)
      .get('/api/conceptos/pres-routes-1/pagos')
      .set(auth);
    expect(concepto.status).toBe(200);
    expect(concepto.body).toHaveLength(1);

    const deuda = await request(app)
      .get('/api/pacientes/pac-caja/deuda')
      .set(auth);
    expect(deuda.status).toBe(200);
    expect(deuda.body).toMatchObject({ paciente_id: 'pac-caja', deuda_total_centavos: 40000 });

    const turnoQuimera = await request(app)
      .get('/api/turnos/turno-quimera/saldo')
      .set(auth);
    expect(turnoQuimera.status).toBe(404);
    expect(turnoQuimera.body.error).toBe('not_found');
  });
});

describe('Cierre diario y consultas administrativas por HTTP (C-11)', () => {
  it('Dado administracion Cuando cierra la caja Entonces 201 snapshot; repetido → 409 cierre_duplicado; recepcion → 403', async () => {
    const app = crearApp();
    const cierre = await request(app)
      .post('/api/caja/cierres')
      .set('Authorization', bearer(['administracion']))
      .send({});
    expect(cierre.status).toBe(201);
    expect(cierre.body).toMatchObject({
      zona_horaria: 'America/Buenos_Aires',
      actor_usuario_id: 'user-caja',
      anulaciones_cantidad: 0,
    });

    const repetido = await request(app)
      .post('/api/caja/cierres')
      .set('Authorization', bearer(['administracion']))
      .send({});
    expect(repetido.status).toBe(409);
    expect(repetido.body.error).toBe('cierre_duplicado');

    const vieAdemares = await request(app)
      .post('/api/caja/cierres')
      .set('Authorization', bearer(['recepcion']))
      .send({});
    expect(vieAdemares.status).toBe(403);
    expect(vieAdemares.body.error).toBe('forbidden');
  });

  it('Dado un día con cierre Cuando admin consulta resumen, movimientos e historial Entonces 200; y los intents de PATCH/PUT/DELETE quedan bloqueados con 404 metodo_no_soportado', async () => {
    const app = crearApp();
    const auth = { Authorization: bearer(['administracion']) };
    await request(app).post('/api/caja/cierres').set(auth).send({});

    const resumen = await request(app)
      .get('/api/caja/resumen?fecha=2026-06-01')
      .set(auth);
    expect(resumen.status).toBe(200);
    expect(resumen.body).toHaveProperty('por_medio');
    expect(resumen.body).toHaveProperty('anulaciones');

    const movimientos = await request(app)
      .get('/api/caja/movimientos?fecha=2026-06-01')
      .set(auth);
    expect(movimientos.status).toBe(200);
    expect(Array.isArray(movimientos.body)).toBe(true);

    const historial = await request(app).get('/api/caja/cierres').set(auth);
    expect(historial.status).toBe(200);
    expect(Array.isArray(historial.body)).toBe(true);

    const fechaRota = await request(app)
      .get('/api/caja/resumen?fecha=01-06-2026')
      .set(auth);
    expect(fechaRota.status).toBe(400);
    expect(fechaRota.body.error).toBe('validacion');

    for (const [metodo, ruta] of [
      ['patch', '/api/caja/cierres'],
      ['patch', '/api/caja/cierres/cualquier-id'],
      ['put', '/api/caja/cierres'],
      ['delete', '/api/caja/cierres'],
      ['delete', '/api/caja/cierres/cualquier-id'],
    ] as const) {
      const res = await request(app)[metodo](ruta).set(auth).send({});
      expect(res.status, `${metodo} ${ruta}`).toBe(404);
      expect(res.body).toEqual({ error: 'metodo_no_soportado' });
    }
  });
});

describe('Mercado Pago por HTTP (C-11, design D7)', () => {
  it('Dado MP configurado Cuando recepcion registra el cobro y administracion confirma con firma válida Entonces 201 pendiente → 200 cobrado; el profesional no puede confirmar (403)', async () => {
    const fake = new FakeCajaProveedorRoutes();
    const app = crearApp(configConMp(), fake);
    const gestion = { Authorization: bearer(['recepcion']) };
    const cierre = { Authorization: bearer(['administracion']) };

    const creado = await request(app).post('/api/pagos').set(gestion).send({
      monto_centavos: 30000,
      medio: 'mercadopago',
      presupuesto_id: 'pres-routes-1',
    });
    expect(creado.status).toBe(201);
    expect(creado.body.estado).toBe('pendiente');
    const link = JSON.parse((creado.body.referencia ?? '{}') as string) as ReferenciaPagoMp;
    expect(link.paymentId).toBe('sbx-pay-routes-1');

    // monto registrado en el adaptador de la API (aprobado)
    aprobarEnFake(fake, link.paymentId, link.externalReference, 30000);

    // recepcion NO confirma (rol de cierre)
    const veto = await request(app)
      .post(`/api/pagos/${creado.body.id}/confirmar`)
      .set(gestion)
      .send({ data: { id: link.paymentId } });
    expect(veto.status).toBe(403);

    // firma inválida → 401 y el proveedor no fue consultado
    const firmaRota = await request(app)
      .post(`/api/pagos/${creado.body.id}/confirmar`)
      .set(cierre)
      .set('x-signature', `ts=1770000000,v1=${'0'.repeat(64)}`)
      .set('x-request-id', 'req-routes-1')
      .send({ data: { id: link.paymentId } });
    expect(firmaRota.status).toBe(401);
    expect(firmaRota.body.error).toBe('mp_firma_invalida');
    expect(fake.consultas).toBe(0);

    // firma y datos correctos → confirmado
    const { xSignature, xRequestId } = firmaWebhook(
      link.paymentId,
      'secreto-webhook-ficticio-routes-c11',
    );
    const confirmado = await request(app)
      .post(`/api/pagos/${creado.body.id}/confirmar`)
      .set(cierre)
      .set('x-signature', xSignature)
      .set('x-request-id', xRequestId)
      .send({ data: { id: link.paymentId } });
    expect(confirmado.status).toBe(200);
    expect(confirmado.body.estado).toBe('cobrado');

    // replay idempotente → 200 sin doble movimiento (la ruta repite 200)
    const replay = await request(app)
      .post(`/api/pagos/${creado.body.id}/confirmar`)
      .set(cierre)
      .set('x-signature', xSignature)
      .set('x-request-id', xRequestId)
      .send({ data: { id: link.paymentId } });
    expect(replay.status).toBe(200);
    expect(replay.body.estado).toBe('cobrado');
  });

  it('Dado MP deshabilitado (sin credenciales) Cuando registran un cobro mercadopago Entonces 503 mp_no_configurado', async () => {
    const app = crearApp(configSinMp(), new FakeCajaProveedorRoutes());
    const res = await request(app)
      .post('/api/pagos')
      .set('Authorization', bearer(['recepcion']))
      .send({
        monto_centavos: 30000,
        medio: 'mercadopago',
        presupuesto_id: 'pres-routes-1',
      });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('mp_no_configurado');
  });

  it('Dado notificación con firma válida pero pago local inexistente Entonces 404 mp_pago_inexistente sin consultar proveedor', async () => {
    const fake = new FakeCajaProveedorRoutes();
    const app = crearApp(configConMp(), fake);
    const { xSignature, xRequestId } = firmaWebhook(
      'sbx-pay-desconocido-999',
      'secreto-webhook-ficticio-routes-c11',
      'req-routes-9',
    );
    const res = await request(app)
      .post('/api/pagos/pago-quimera/confirmar')
      .set('Authorization', bearer(['administracion']))
      .set('x-signature', xSignature)
      .set('x-request-id', xRequestId)
      .send({ data: { id: 'sbx-pay-desconocido-999' } });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('mp_pago_inexistente');
    expect(fake.consultas).toBe(0);
  });
});
