/**
 * Adaptador sandbox de Mercado Pago (C-11, design D7): única implementación
 * proveedora del change, sin HTTP real al proveedor (sin cobros reales).
 * - `crearIntencion`: produce referencias estructuradas de sandbox (id de pago
 *   del proveedor + external_reference trazable) para simular la creación de la
 *   preferencia.
 * - `consultarPago`: en este change el verificador directo
 *   (`GET /v1/payments/{id}` con Bearer del servidor, doc oficial) se activa
 *   al incorporar credenciales reales (cambio de adaptador); el adaptador
 *   sandbox falla como error de proveedor (`MpProveedorError` → 502) y el pago
 *   queda `pendiente`, jamás confirmado sin verificación.
 * En tests las respuestas del proveedor se simulan en el límite de esta
 * interfaz (R12): nunca detrás ni mockeando la capa de transacción.
 */
import { randomUUID } from 'node:crypto';
import {
  MpProveedorError,
  type IntencionPagoMp,
  type MercadoPagoProveedor,
  type PagoVerificadoMp,
  type ReferenciaPagoMp,
} from './proveedor.js';

/**
 * external_reference estructurada: derivable del pago local y contrastable
 * exactamente al verificar (la string condiciona el vínculo del pago remoto).
 */
export function externalReferenceSandboxMp(pagoId: string): string {
  return `mp-sandbox:pago=${pagoId}`;
}

export class MpSandboxAdapter implements MercadoPagoProveedor {
  crearIntencion(intencion: IntencionPagoMp): ReferenciaPagoMp {
    return {
      paymentId: `sbx-pay-${randomUUID()}`,
      externalReference: externalReferenceSandboxMp(intencion.pagoId),
    };
  }

  consultarPago(_paymentId: string): PagoVerificadoMp {
    throw new MpProveedorError(
      'verificación directa no disponible en el adaptador sandbox de este change',
    );
  }
}
