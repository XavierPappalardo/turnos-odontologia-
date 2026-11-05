/**
 * Interfaz de proveedor de Mercado Pago (C-11, design D7).
 * Barrera de integración: la lógica de caja nunca ve HTTP ni contratos de la
 * API del proveedor; solo esta interfaz (una única forma de comunicar: en este
 * change el adaptador sandbox no emite HTTP real; con credenciales reales solo
 * cambia el adaptador). En tests las respuestas del proveedor se simulan
 * exactamente en este límite (R12): la capa de transacción sigue siendo
 * SQLite real, nunca mockeada.
 */

/** Datos de la intención de pago local (structura mínima, ids opacos internos, R3). */
export interface IntencionPagoMp {
  readonly pagoId: string;
  readonly montoCentavos: number;
}

/** Referencia estructurada devuelta por el proveedor al crear la intención. */
export interface ReferenciaPagoMp {
  /**
   * Identificador del pago en el proveedor (llega como `data.id` en el webhook;
   * se guarda en `pago.referencia` para vincular la notificación con el pago local).
   */
  readonly paymentId: string;
  /**
   * `external_reference` registrada en el proveedor (p. ej. `mp-sandbox:pago=<id>`);
   * se contrasta exactamente al verificar el pago directo en la API.
   */
  readonly externalReference: string;
}

/** Pago consultado directamente al proveedor: GET /v1/payments/{id} (doc oficial). */
export interface PagoVerificadoMp {
  readonly paymentId: string;
  /** Estado del proveedor; conferir `approved` para computar el cobro. */
  readonly estado: string;
  /** Importe exacto en centavos convertido por el adaptador (R2: sin floats sueltos). */
  readonly montoCentavos: number;
  readonly moneda: string;
  readonly externalReference: string;
}

/**
 * Falla del proveedor (timeout, respuesta inválida, caída) → `502 mp_error_proveedor`
 * con log de solo id interno y tipo de error (R3).
 */
export class MpProveedorError extends Error {
  /** Mensaje público genérico (sin detalles de red ni credenciales, R3/R15). */
  mensajePublico: string;

  constructor(message: string) {
    super(message);
    this.name = 'MpProveedorError';
    // R3/R15: el mensaje público no expone detalles internos ni credenciales.
    this.mensajePublico = 'el proveedor de pagos no pudo ser consultado';
  }
}

/** El pago no se encuentra en la API del proveedor → `422 mp_pago_no_verificado`. */
export class MpPagoInexistenteProveedorError extends MpProveedorError {
  constructor(message: string) {
    super(message);
    this.name = 'MpPagoInexistenteProveedorError';
    this.mensajePublico = 'el pago no se pudo verificar en el proveedor';
  }
}

/**
 * Interfaz de acceso al proveedor. Únicas operaciones permitidas:
 * - crear la intención de pago (devolver referencia estructurada);
 * - verificar un pago directo con el Bearer del servidor (doc oficial).
 * No se inventan endpoints: cualquier otra comunicación queda fuera (D7).
 */
export interface MercadoPagoProveedor {
  crearIntencion(intencion: IntencionPagoMp): ReferenciaPagoMp;
  consultarPago(paymentId: string): PagoVerificadoMp;
}
