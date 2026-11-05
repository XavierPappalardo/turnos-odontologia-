/**
 * Validación de la firma del webhook de Mercado Pago (C-11, design D7).
 * Documentación oficial: la notificación autentica con los headers
 * `x-signature` (formato `ts=<timestamp>,v1=<hex>`), `x-request-id` y `data.id`
 * del body. El material firmado ("manifest") según la documentación oficial es:
 *   `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 * y la firma v1 es HMAC-SHA256(manifest, secreto de webhook) en hex.
 * Comparación en tiempo constante con `crypto.timingSafeEqual`; concretamente
 * `MP_WEBHOOK_SECRET` es el secreto de sandbox (nunca expuesto, R3/R15).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Construye el manifest firmado según el formato documentado del proveedor. */
export function construirManifestWebhookMp(args: {
  paymentId: string;
  requestId: string;
  ts: string;
}): string {
  return `id:${args.paymentId};request-id:${args.requestId};ts:${args.ts};`;
}

/** Compara dos buffers en tiempo constante (equal length guard + timingSafeEqual). */
function comparacionTiempoConstante(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verifica la firma `x-signature` de una notificación dirigida al pago con id
 * externo `paymentId`. Devuelve `true` solo si el `v1` presente coincide con el
 * HMAC-SHA256 esperado. No revela el secreto ni detalles más allá del resultado.
 */
export function verificarFirmaWebhookMp(args: {
  /** Header `x-signature` crudo (`ts=...,v1=...`). */
  signatureHeader: string | undefined;
  /** Header `x-request-id` de la notificación. */
  requestId: string | undefined;
  /** `data.id` del body de la notificación. */
  paymentId: string | undefined;
  /** Secreto de webhook configurado (`MP_WEBHOOK_SECRET`). */
  secreto: string;
}): boolean {
  if (
    args.signatureHeader === undefined ||
    args.requestId === undefined ||
    args.paymentId === undefined
  ) {
    return false;
  }
  const firma = parseSignatureHeader(args.signatureHeader);
  if (firma === undefined) return false;
  const manifest = construirManifestWebhookMp({
    paymentId: args.paymentId,
    requestId: args.requestId,
    ts: firma.ts,
  });
  const esperado = createHmac('sha256', args.secreto)
    .update(manifest)
    .digest('hex');
  return comparacionTiempoConstante(
    Buffer.from(esperado, 'hex'),
    Buffer.from(firma.v1, 'hex'),
  );
}

/** Parseo tolerante del header `x-signature`: devuelve `ts` y `v1` o `undefined`. */
function parseSignatureHeader(
  header: string,
): { ts: string; v1: string } | undefined {
  let ts: string | undefined;
  let v1: string | undefined;
  for (const parte of header.split(',')) {
    const [clave, valor] = parte.trim().split('=');
    if (clave === 'ts' && valor !== undefined) ts = valor.trim();
    if (clave === 'v1' && valor !== undefined) v1 = valor.trim().toLowerCase();
  }
  if (ts === undefined || v1 === undefined || ts === '' || !esHex256(v1)) {
    return undefined;
  }
  return { ts, v1 };
}

/** HMAC-SHA256 en hex: 64 caracteres hexadecimales exactos. */
function esHex256(valor: string): boolean {
  return /^[0-9a-f]{64}$/.test(valor);
}
