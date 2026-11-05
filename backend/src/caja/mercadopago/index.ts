/**
 * Barrera de integración Mercado Pago (C-11, design D7): sandbox-only.
 * Todo acceso del servicio de caja al proveedor pasa por esta interfaz y sus
 * tipos; ningún contrato HTTP suelto en el resto del código (R7/R8).
 */
export {
  MpPagoInexistenteProveedorError,
  MpProveedorError,
  type IntencionPagoMp,
  type MercadoPagoProveedor,
  type PagoVerificadoMp,
  type ReferenciaPagoMp,
} from './proveedor.js';
export { construirManifestWebhookMp, verificarFirmaWebhookMp } from './firmas.js';
export { externalReferenceSandboxMp, MpSandboxAdapter } from './mp-sandbox-adapter.js';
