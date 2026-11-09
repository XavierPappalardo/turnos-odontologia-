import { AppError } from '../../shared/errors.js';
import {
  type ErrorFila,
  type FilaNormalizada,
  type FormatoImportacion,
  FORMATOS,
  MAX_CONTENIDO_BYTES,
  MAX_FILAS_IMPORTACION,
} from './tipos.js';

function asegurarLimites(contenido: string): void {
  if (typeof contenido !== 'string' || contenido.length === 0) {
    throw new AppError({ status: 400, code: 'validacion', message: 'contenido requerido' });
  }
  // Aproximación segura de tamaño.
  if (Buffer.byteLength(contenido, 'utf8') > MAX_CONTENIDO_BYTES * 2) {
    throw new AppError({ status: 400, code: 'validacion', message: 'archivo excede límite permitido' });
  }
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseCsv(contenido: string): FilaNormalizada[] {
  const lines = contenido
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]!).map((h) => h.trim());
  const filas: FilaNormalizada[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (filas.length >= MAX_FILAS_IMPORTACION) break;
    const cols = parseCsvLine(lines[i]!);
    const datos: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) datos[h] = (cols[idx] ?? '').trim();
    });
    filas.push({ fila: i, datos });
  }
  return filas;
}

async function parseExcelBase64(contenido: string): Promise<FilaNormalizada[]> {
  let xlsx: typeof import('xlsx');
  try {
    xlsx = await import('xlsx');
  } catch {
    throw new AppError({ status: 400, code: 'formato_no_soportado', message: 'formato Excel no disponible en este entorno' });
  }
  const buf = Buffer.from(contenido, 'base64');
  if (buf.length > MAX_CONTENIDO_BYTES) {
    throw new AppError({ status: 400, code: 'validacion', message: 'archivo excede límite permitido' });
  }
  const wb = xlsx.read(buf, { type: 'buffer' });
  const name = wb.SheetNames[0];
  if (!name) return [];
  const sheet = wb.Sheets[name];
  const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet!, { defval: '' });
  const filas: FilaNormalizada[] = [];
  for (let i = 0; i < rows.length && filas.length < MAX_FILAS_IMPORTACION; i++) {
    const raw = rows[i]!;
    const datos: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      datos[String(k).trim()] = v == null ? '' : String(v).trim();
    }
    filas.push({ fila: i + 1, datos });
  }
  return filas;
}

export async function parsearContenido(
  formato: FormatoImportacion,
  contenido: string,
): Promise<{ filas: FilaNormalizada[]; errores: ErrorFila[] }> {
  if (!FORMATOS.includes(formato)) {
    throw new AppError({ status: 400, code: 'formato_no_soportado', message: 'formato no soportado' });
  }
  asegurarLimites(contenido);
  if (formato === 'csv') {
    return { filas: parseCsv(contenido), errores: [] };
  }
  if (formato === 'xlsx' || formato === 'xls') {
    return { filas: await parseExcelBase64(contenido), errores: [] };
  }
  throw new AppError({ status: 400, code: 'formato_no_soportado', message: 'formato no soportado' });
}

export function aplicarMapeo(
  filas: FilaNormalizada[],
  mapeo: Record<string, string> | undefined,
): FilaNormalizada[] {
  if (!mapeo || Object.keys(mapeo).length === 0) return filas;
  return filas.map((f) => {
    const datos: Record<string, string> = {};
    for (const [destino, origen] of Object.entries(mapeo)) {
      if (origen && Object.prototype.hasOwnProperty.call(f.datos, origen)) datos[destino] = f.datos[origen] ?? '';
      else if (Object.prototype.hasOwnProperty.call(f.datos, destino)) datos[destino] = f.datos[destino] ?? '';
    }
    // conservar campos no mapeados si ya tienen nombre destino
    for (const [k, v] of Object.entries(f.datos)) {
      if (!(k in datos)) datos[k] = v;
    }
    return { fila: f.fila, datos };
  });
}
