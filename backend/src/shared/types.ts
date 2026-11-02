/**
 * Brand types de dominio (R10: TypeScript estricto, sin `any`).
 * Cada identificador de dominio es un tipo opaco distinto:
 * `PatientId ≠ TurnoId ≠ ProfesionalId`.
 * Datos ficticios en tests (R1/R12).
 */

declare const __brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type TurnoId = Brand<string, 'TurnoId'>;
export type ProfesionalId = Brand<string, 'ProfesionalId'>;
export type SillonId = Brand<string, 'SillonId'>;
export type PacienteId = Brand<string, 'PacienteId'>;
export type PrestacionId = Brand<string, 'PrestacionId'>;
export type BloqueoId = Brand<string, 'BloqueoId'>;
export type UsuarioId = Brand<string, 'UsuarioId'>;

/** Identificadores de entidades clínicas (C-09). */
export type HcEventoId = Brand<string, 'HcEventoId'>;
export type OdontogramaEventoId = Brand<string, 'OdontogramaEventoId'>;
export type DelegacionHcId = Brand<string, 'DelegacionHcId'>;

/** Tipos de dominio clínico (C-09). */
export type TipoEventoHc =
  | 'consulta'
  | 'nota'
  | 'diagnostico'
  | 'procedimiento';

export type SuperficieFdi = 'M' | 'D' | 'V' | 'L' | 'O' | 'I';

export type HallazgoOdontograma =
  | 'sano'
  | 'caries'
  | 'obturado'
  | 'ausente'
  | 'corona'
  | 'endodoncia'
  | 'implante'
  | 'extraccion_indicada'
  | 'sellante'
  | 'fractura';

export type TurnoEstado =
  | 'reservado'
  | 'confirmado'
  | 'presente'
  | 'atendido'
  | 'cancelado'
  | 'ausente';

export type TurnoOrigen = 'recepcion' | 'online' | 'whatsapp';

/** Roles del MVP (KB-03). */
export type Rol = 'recepcion' | 'profesional' | 'administracion';
export const ROLES: readonly Rol[] = ['recepcion', 'profesional', 'administracion'];

/** Estados que OCUPAN agenda (RN-01/RN-02, design D4). */
export const ESTADOS_ACTIVOS: readonly TurnoEstado[] = [
  'reservado',
  'confirmado',
  'presente',
] as const;

/** Estados que LIBERAN agenda (design D4). */
export const ESTADOS_LIBRES: readonly TurnoEstado[] = [
  'cancelado',
  'ausente',
  'atendido',
] as const;

export function esEstadoActivo(estado: string): boolean {
  return (ESTADOS_ACTIVOS as readonly string[]).includes(estado);
}
