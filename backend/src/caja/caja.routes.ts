/**
 * Task 5.1/5.2: rutas de caja (C-11) montadas bajo /api.
 * Gestion (cobros, anulaciones, historiales, saldo y deuda):
 *   `recepcion` y `administracion` (ROLES_CAJA_GESTION).
 * Cierre y confirmacion MP (snapshot del dia, resumen, movimientos,
 *   historial de cierres, confirmar pago pendiente): solo `administracion`
 *   (ROLES_CAJA_CIERRE). Profesional: 403 en todo el dominio (R4).
 * Confirmacion MP = canal interno sandbox en dos etapas: la firma del webhook
 *   (x-signature / x-request-id / data.id) y la verificacion al proveedor se
 *   resuelven en el servicio; aca solo se recortan los datos de la request.
 * Errores tipados via error-handler central, sin PHI (R3).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { getAuth, requireAuth, requireRoles } from '../auth/middleware.js';
import { ROLES_CAJA_CIERRE, ROLES_CAJA_GESTION } from '../shared/auth.js';
import type { AppConfig } from '../shared/config.js';
import { CajaService, type MercadoPagoCajaOptions } from './caja.service.js';
import { MpSandboxAdapter, type MercadoPagoProveedor } from './mercadopago/index.js';

/**
 * Construye las opciones de Mercado Pago del servicio. Sin token + secreto
 * de firma configurado la integracion queda deshabilitada (503
 * `mp_no_configurado` en cobros/confirmaciones MP, sin defaults silenciosos).
 */
function opcionesMercadoPago(
  config: AppConfig,
  proveedor: MercadoPagoProveedor | undefined,
): MercadoPagoCajaOptions | undefined {
  if (
    config.mercadopago.habilitado &&
    config.mercadopago.webhookSecret !== null
  ) {
    return {
      proveedor: proveedor ?? new MpSandboxAdapter(),
      webhookSecret: config.mercadopago.webhookSecret,
    };
  }
  return undefined;
}

type Manejador = (req: Request, res: Response, next: NextFunction) => void;

/** Envuelve el handler agregando la traduccion de errores (try/catch → next). */
function manejar(fn: (req: Request, res: Response) => unknown): Manejador {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      fn(req, res);
    } catch (err) {
      next(err);
    }
  };
}

export function cajaRouter(
  db: DatabaseSync,
  config: AppConfig,
  mpProveedor?: MercadoPagoProveedor,
): Router {
  const router = Router();
  const service = new CajaService(db, {
    zonaHoraria: config.caja.zonaHoraria,
    mercadopago: opcionesMercadoPago(config, mpProveedor),
  });
  const autenticado = requireAuth(config.jwtSecret, db);
  const gestion = requireRoles(...ROLES_CAJA_GESTION);
  const cierre = requireRoles(...ROLES_CAJA_CIERRE);

  // POST /pagos — registrar cobro con medio + aplicación (201; 200 idempotente).
  router.post(
    '/pagos',
    autenticado,
    gestion,
    manejar((req, res) => {
      const auth = getAuth(res);
      const body = (req.body ?? {}) as {
        monto_centavos?: unknown;
        medio?: unknown;
        presupuesto_id?: unknown;
        turno_id?: unknown;
        clave_idempotencia?: unknown;
        referencia?: unknown;
        fecha_contable?: unknown;
      };
      const resultado = service.registrarCobro({
        montoCentavos:
          typeof body.monto_centavos === 'number' ? body.monto_centavos : NaN,
        medio: typeof body.medio === 'string' ? body.medio : '',
        presupuestoId:
          typeof body.presupuesto_id === 'string' ? body.presupuesto_id : undefined,
        turnoId: typeof body.turno_id === 'string' ? body.turno_id : undefined,
        claveIdempotencia:
          typeof body.clave_idempotencia === 'string'
            ? body.clave_idempotencia
            : undefined,
        referencia:
          typeof body.referencia === 'string' ? body.referencia : undefined,
        fechaContable:
          typeof body.fecha_contable === 'string' ? body.fecha_contable : undefined,
        actorUsuarioId: auth.userId,
      });
      res.status(resultado.idempotente ? 200 : 201).json(resultado.pago);
    }),
  );

  // POST /pagos/:id/anular — cobrado → anulado con motivo obligatorio.
  router.post(
    '/pagos/:id/anular',
    autenticado,
    gestion,
    manejar((req, res) => {
      const auth = getAuth(res);
      const body = (req.body ?? {}) as { motivo?: unknown };
      const pago = service.anularPago({
        pagoId: req.params.id,
        actorUsuarioId: auth.userId,
        motivo: typeof body.motivo === 'string' ? body.motivo : '',
      });
      res.status(200).json(pago);
    }),
  );

  // POST /pagos/:id/confirmar — confirmación MP (solo administracion):
  // firma del webhook (headers) + verificación directa al proveedor.
  router.post(
    '/pagos/:id/confirmar',
    autenticado,
    cierre,
    manejar((req, res) => {
      const auth = getAuth(res);
      const body = (req.body ?? {}) as { data?: { id?: unknown } };
      const dataId = body.data?.id;
      const pago = service.confirmarPagoMp({
        pagoId: req.params.id,
        paymentId: typeof dataId === 'string' ? dataId : '',
        signatureHeader: req.header('x-signature'),
        requestId: req.header('x-request-id'),
        actorUsuarioId: auth.userId,
      });
      res.status(200).json(pago);
    }),
  );

  // GET /turnos/:turnoId/pagos — historial del turno, incluye anulados.
  router.get(
    '/turnos/:turnoId/pagos',
    autenticado,
    gestion,
    manejar((req, res) => {
      res.status(200).json(service.historialPorTurno(req.params.turnoId));
    }),
  );

  // GET /turnos/:turnoId/saldo — saldo por turno en centavos exactos.
  router.get(
    '/turnos/:turnoId/saldo',
    autenticado,
    gestion,
    manejar((req, res) => {
      res.status(200).json(service.saldoPorTurno(req.params.turnoId));
    }),
  );

  // GET /conceptos/:presupuestoId/pagos — historial por concepto.
  router.get(
    '/conceptos/:presupuestoId/pagos',
    autenticado,
    gestion,
    manejar((req, res) => {
      res.status(200).json(service.historialPorConcepto(req.params.presupuestoId));
    }),
  );

  // GET /pacientes/:pacienteId/deuda — deuda bolsillo por concepto.
  router.get(
    '/pacientes/:pacienteId/deuda',
    autenticado,
    gestion,
    manejar((req, res) => {
      res.status(200).json(service.deudaPorPaciente(req.params.pacienteId));
    }),
  );

  // POST /caja/cierres — cierre del día contable (201 snapshot inmutable).
  router.post(
    '/caja/cierres',
    autenticado,
    cierre,
    manejar((req, res) => {
      const auth = getAuth(res);
      const cierre = service.cerrarCaja({ actorUsuarioId: auth.userId });
      res.status(201).json(cierre);
    }),
  );

  // GET /caja/resumen?fecha=YYYY-MM-DD
  router.get(
    '/caja/resumen',
    autenticado,
    cierre,
    manejar((req, res) => {
      const fecha = typeof req.query.fecha === 'string' ? req.query.fecha : '';
      res.status(200).json(service.resumenPorDia(fecha));
    }),
  );

  // GET /caja/cierres — historial de cierres.
  router.get(
    '/caja/cierres',
    autenticado,
    cierre,
    manejar((_req, res) => {
      res.status(200).json(service.historialCierres());
    }),
  );

  // GET /caja/movimientos?fecha=YYYY-MM-DD — movimientos con asignación trazable.
  router.get(
    '/caja/movimientos',
    autenticado,
    cierre,
    manejar((req, res) => {
      const fecha = typeof req.query.fecha === 'string' ? req.query.fecha : '';
      res.status(200).json(service.movimientosPorFecha(fecha));
    }),
  );

  // Los cierres no exponen edición/borrado por ninguna vía del API (snapshot
  // histórico inmutable de C-11, sin ajustes manuales): cualquier intento
  // responde 404 método no soportado.
  function metodoNoSoportado(_req: Request, res: Response): void {
    res.status(404).json({ error: 'metodo_no_soportado' });
  }
  router.patch('/caja/cierres', metodoNoSoportado);
  router.patch('/caja/cierres/:id', metodoNoSoportado);
  router.put('/caja/cierres', metodoNoSoportado);
  router.put('/caja/cierres/:id', metodoNoSoportado);
  router.delete('/caja/cierres', metodoNoSoportado);
  router.delete('/caja/cierres/:id', metodoNoSoportado);

  return router;
}
