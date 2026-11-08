/**
 * Servicio de configuración de comisiones (C-13, task 5.1; design D2/D13).
 * Patrón C-12 (`obras-sociales/liquidaciones.service.ts`): clase con
 * repositorios + `UnitOfWork.runInTransaction` (BEGIN IMMEDIATE, R12),
 * validación fail-fast fuera de la tx y verificación exigible dentro.
 *
 * - `guardarConfiguracion`: upsert idempotente del % general (una única fila
 *   vigente por profesional, indicie parcial `com_config_prof_activa`) y
 *   REEMPLAZO COMPLETO del conjunto de tratamientos (RN-08/D2: el % específico
 *   reemplaza al general; el conjunto vigente queda exactamente el del body).
 * - `obtenerConfiguracion`: lectura pura (config general vigente o `null` +
 *   tratamientos vigentes) — insumo directo del motor de cálculo.
 * - R6: porcentajes enteros exactos 0..100 (el CHECK del DDL es la segunda
 *   línea de defensa; el servicio responde `validacion` con detalle).
 * - R4: el profesional debe existir y estar activo (`not_found`).
 * - D7 del change: conflictos de unicidad → `409 identidad_ya_configurada`.
 *   Nota de límite documentado: el upsert `ON CONFLICT ... DO UPDATE` + la
 *   serialización de escritor de SQLite (`BEGIN IMMEDIATE`) cierran la raza
 *   honesta, así que el mapeo de la UNIQUE queda como defensa en cinturón;
 *   no es alcanzable por la API pública.
 * - R3: mensajes sin PHI, solo concepts opacos.
 *
 * R8: el acceso a datos es SOLO por repositorios/BaseRepository; las lecturas
 * puntuales de `profesional` y `prestacion` usan `findById` de
 * `BaseRepository` (no existe repositorio de dominio propio).
 */
import type { DatabaseSync } from 'node:sqlite';
import { BaseRepository, UnitOfWork } from '../shared/repository.js';
import { ComisionError } from '../shared/errors.js';
import {
  type ConfigGeneralCalculo,
  type ConfigTratamientoCalculo,
} from './calculo.js';
import {
  ProfesionalComisionRepository,
  ProfesionalComisionTratamientoRepository,
  type ProfesionalComisionRow,
  type ProfesionalComisionTratamientoRow,
} from './config.repository.js';

/** Fila mínima de `profesional` para la verificación de actividad (R4/R8). */
interface ProfesionalFila {
  id: string;
  activo: number;
}

/** Fila mínima de `prestacion` para la verificación de existencia (FK). */
interface PrestacionFila {
  id: string;
}

/** Tratamiento del body: par (prestación, %) — reemplazo completo (D2/RN-08). */
export interface TratamientoConfigInput {
  prestacion_id: string;
  pct: number;
}

export interface GuardarConfiguracionInput {
  profesional_id: string;
  /** % general entero exacto 0..100 (R6). */
  pct_general: number;
  /** Conjunto COMPLETO de tratamientos vigentes tras la operación. */
  tratamientos: readonly TratamientoConfigInput[];
}

export interface ConfiguracionComision {
  /** `null` si el profesional no tiene % general vigente (D13). */
  config: ConfigGeneralCalculo | null;
  /** Tratamientos vigentes, orden canon por `prestacion_id` (D13). */
  tratamientos: ConfigTratamientoCalculo[];
}

/**
 * Detección de violación de UNIQUE de node:sqlite (patrón C-12): el error
 * crudo explica `UNIQUE constraint failed: tabla.col`. Exportada para poder
 * verificar el mapeo con errores sintéticos (la violación real no es
 * alcanzable por la API pública: ver nota de límite en el encabezado).
 */
export function esViolacionUnica(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint/i.test(err.message);
}

/** Conversión fila de BD → forma de cálculo/fingerprint (D13). */
export function aConfigGeneral(row: ProfesionalComisionRow): ConfigGeneralCalculo {
  return {
    id: row.id,
    profesional_id: row.profesional_id,
    pct_general: row.pct_general,
    updated_at: row.updated_at,
  };
}

/** Conversión fila de BD → forma de cálculo/fingerprint (D13). */
export function aConfigTratamiento(
  row: ProfesionalComisionTratamientoRow,
): ConfigTratamientoCalculo {
  return {
    id: row.id,
    profesional_id: row.profesional_id,
    prestacion_id: row.prestacion_id,
    pct: row.pct,
  };
}

function errorValidacion(detalle: string): ComisionError {
  return new ComisionError({
    status: 422,
    code: 'validacion',
    message: 'validación de entrada',
    detalle,
  });
}

/** R6: porcentajes enteros exactos 0..100 (servicio; CHECK DDL de respaldo). */
function exigirPctValido(valor: unknown, campo: string): void {
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 0 || valor > 100) {
    throw errorValidacion(`${campo} debe ser un entero 0..100`);
  }
}

export class ComisionesConfigService {
  private readonly db: DatabaseSync;
  private readonly configs: ProfesionalComisionRepository;
  private readonly tratamientos: ProfesionalComisionTratamientoRepository;
  private readonly profesionales: BaseRepository<ProfesionalFila>;
  private readonly prestaciones: BaseRepository<PrestacionFila>;
  private readonly uow: UnitOfWork;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.configs = new ProfesionalComisionRepository(db);
    this.tratamientos = new ProfesionalComisionTratamientoRepository(db);
    this.profesionales = new BaseRepository<ProfesionalFila>(db, 'profesional');
    this.prestaciones = new BaseRepository<PrestacionFila>(db, 'prestacion');
    this.uow = new UnitOfWork(db);
  }

  /**
   * Upsert idempotente del % general + reemplazo completo de tratamientos en
   * UNA transacción `BEGIN IMMEDIATE` (task 5.1). Llamadas repetidas con el
   * mismo body dejan exactamente una fila vigente por profesional y el
   * conjunto de tratamientos exactamente el del body.
   */
  guardarConfiguracion(input: GuardarConfiguracionInput): ConfiguracionComision {
    if (typeof input.pct_general !== 'number') {
      throw errorValidacion('pct_general debe ser numérico');
    }
    exigirPctValido(input.pct_general, 'pct_general');
    for (const tratamiento of input.tratamientos) {
      exigirPctValido(tratamiento.pct, 'pct');
    }
    const prestacionesDeseadas = input.tratamientos.map((t) => t.prestacion_id);
    if (new Set(prestacionesDeseadas).size !== prestacionesDeseadas.length) {
      throw errorValidacion('prestacion_id duplicado en el body');
    }

    const filaProfesional = this.profesionales.findById(input.profesional_id);
    if (filaProfesional === undefined || filaProfesional.activo !== 1) {
      throw new ComisionError({
        status: 404,
        code: 'not_found',
        message: 'profesional inexistente o inactivo',
      });
    }
    for (const prestacionId of prestacionesDeseadas) {
      if (this.prestaciones.findById(prestacionId) === undefined) {
        throw errorValidacion('prestacion_id inexistente');
      }
    }

    this.uow.runInTransaction(() => {
      try {
        this.configs.upsert({
          profesionalId: input.profesional_id,
          pctGeneral: input.pct_general,
        });
        // Reemplazo completo (D2/RN-08): desactivar los ausentes, upsert presentes.
        const vigentes = this.tratamientos.listarVigentes(input.profesional_id);
        const deseadas = new Set(prestacionesDeseadas);
        for (const vigente of vigentes) {
          if (!deseadas.has(vigente.prestacion_id)) {
            this.tratamientos.desactivar(vigente.id);
          }
        }
        for (const tratamiento of input.tratamientos) {
          this.tratamientos.upsert({
            profesionalId: input.profesional_id,
            prestacionId: tratamiento.prestacion_id,
            pct: tratamiento.pct,
          });
        }
      } catch (err: unknown) {
        if (esViolacionUnica(err)) {
          throw new ComisionError({
            status: 409,
            code: 'identidad_ya_configurada',
            message: 'conflicto de unicidad de configuración',
          });
        }
        throw err;
      }
    });
    return this.obtenerConfiguracion(input.profesional_id);
  }

  /** Lectura pura del estado de configuración del profesional (task 5.1). */
  obtenerConfiguracion(profesionalId: string): ConfiguracionComision {
    const filaConfig = this.configs.obtenerConfigVigente(profesionalId);
    return {
      config: filaConfig === undefined ? null : aConfigGeneral(filaConfig),
      tratamientos: this.tratamientos
        .listarVigentes(profesionalId)
        .map(aConfigTratamiento),
    };
  }
}
