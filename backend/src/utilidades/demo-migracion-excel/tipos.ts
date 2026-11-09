export type EntidadImportacion = 'pacientes' | 'profesionales' | 'turnos';
export type FormatoImportacion = 'csv' | 'xlsx' | 'xls';

export interface ErrorFila {
  fila: number; // 1-based en datos (excluye encabezado)
  campo?: string;
  codigo:
    | 'campo_requerido'
    | 'formato_invalido'
    | 'referencia_inexistente'
    | 'duplicado'
    | 'solapamiento'
    | 'regla_negocio'
    | 'mapeo_invalido'
    | 'entidad_no_soportada';
  mensaje: string;
}

export interface FilaNormalizada {
  fila: number;
  datos: Record<string, string>;
}

export interface ResultadoPreview {
  entidad: EntidadImportacion;
  formato: FormatoImportacion;
  totalFilas: number;
  filasValidas: number;
  filasInvalidas: number;
  errores: ErrorFila[];
  muestrasSeguras: Array<{ fila: number; campos: string[] }>;
  persistido: false;
}

export interface ResultadoConfirmacion {
  entidad: EntidadImportacion;
  formato: FormatoImportacion;
  totalFilas: number;
  insertadas: number;
  rechazadas: number;
  errores: ErrorFila[];
}

export interface PayloadImportacion {
  entidad: EntidadImportacion;
  formato: FormatoImportacion;
  /** CSV como texto, o Excel como base64. */
  contenido: string;
  mapeo?: Record<string, string>;
}

export const MAX_FILAS_IMPORTACION = 2000;
export const MAX_CONTENIDO_BYTES = 2 * 1024 * 1024;

export const ENTIDADES: readonly EntidadImportacion[] = ['pacientes', 'profesionales', 'turnos'];
export const FORMATOS: readonly FormatoImportacion[] = ['csv', 'xlsx', 'xls'];
