/**
 * Servicio de planes de obra social (C-12, tareas 4.1 y 4.2).
 * Validaciones estrictas R6 (0..100 enteros), allowlist en PATCH y soft delete Q5.
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  ObraSocialPlanRepository,
  type ObraSocialPlanFiltros,
} from '../core/obraSocialPlan.repository.js';
import type { ObraSocialPlanRow } from '../core/models.js';
import {
  ObraSocialConflictoError,
  ObraSocialNotFoundError,
  ObraSocialValidacionError,
} from './errors.js';

export interface CrearPlanInput {
  obra_social: string;
  plan: string;
  cobertura_pct: number;
}

const ALLOWLIST_PATCH_PLAN = ['obra_social', 'plan', 'cobertura_pct', 'activo'] as const;
type CampoPatchPlan = (typeof ALLOWLIST_PATCH_PLAN)[number];

export class PlanesService {
  private readonly repo: ObraSocialPlanRepository;

  constructor(db: DatabaseSync) {
    this.repo = new ObraSocialPlanRepository(db);
  }

  listarPlanes(filtros: ObraSocialPlanFiltros = {}): ObraSocialPlanRow[] {
    return this.repo.listarVigentes(filtros);
  }

  buscarPorId(id: string): ObraSocialPlanRow {
    const plan = this.repo.buscarPorIdVigente(id);
    if (!plan) {
      throw new ObraSocialNotFoundError('Plan de obra social no encontrado');
    }
    return plan;
  }

  crearPlan(input: CrearPlanInput): ObraSocialPlanRow {
    if (
      typeof input.obra_social !== 'string' ||
      input.obra_social.trim() === ''
    ) {
      throw new ObraSocialValidacionError('obra_social es requerida');
    }

    if (typeof input.plan !== 'string' || input.plan.trim() === '') {
      throw new ObraSocialValidacionError('plan es requerido');
    }

    if (
      typeof input.cobertura_pct !== 'number' ||
      !Number.isInteger(input.cobertura_pct) ||
      input.cobertura_pct < 0 ||
      input.cobertura_pct > 100
    ) {
      throw new ObraSocialValidacionError(
        'cobertura_pct debe ser un entero entre 0 y 100',
      );
    }

    const id = randomUUID();
    const row = {
      id,
      obra_social: input.obra_social.trim(),
      plan: input.plan.trim(),
      cobertura_pct: input.cobertura_pct,
      activo: 1,
      deleted_at: null,
    };

    try {
      this.repo.insert(row);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err.message.includes('UNIQUE') ||
          err.message.includes('SQLITE_CONSTRAINT'))
      ) {
        throw new ObraSocialConflictoError(
          'La combinación obra social y plan ya existe',
        );
      }
      throw err;
    }

    const created = this.repo.buscarPorIdVigente(id);
    if (!created) {
      throw new Error('Error al recuperar plan creado');
    }
    return created;
  }

  actualizarPlan(id: string, patch: Record<string, unknown>): ObraSocialPlanRow {
    const plan = this.repo.buscarPorIdVigente(id);
    if (!plan) {
      throw new ObraSocialNotFoundError('Plan de obra social no encontrado');
    }

    const keys = Object.keys(patch);
    if (keys.length === 0) {
      throw new ObraSocialValidacionError('Debe enviar al menos un campo');
    }

    for (const key of keys) {
      if (!ALLOWLIST_PATCH_PLAN.includes(key as CampoPatchPlan)) {
        throw new ObraSocialValidacionError(`Campo no permitido: ${key}`);
      }
    }

    const datosValidados: Partial<
      Pick<ObraSocialPlanRow, 'obra_social' | 'plan' | 'cobertura_pct' | 'activo'>
    > = {};

    if (patch.obra_social !== undefined) {
      if (
        typeof patch.obra_social !== 'string' ||
        patch.obra_social.trim() === ''
      ) {
        throw new ObraSocialValidacionError('obra_social no puede ser vacía');
      }
      datosValidados.obra_social = patch.obra_social.trim();
    }

    if (patch.plan !== undefined) {
      if (typeof patch.plan !== 'string' || patch.plan.trim() === '') {
        throw new ObraSocialValidacionError('plan no puede ser vacío');
      }
      datosValidados.plan = patch.plan.trim();
    }

    if (patch.cobertura_pct !== undefined) {
      if (
        typeof patch.cobertura_pct !== 'number' ||
        !Number.isInteger(patch.cobertura_pct) ||
        patch.cobertura_pct < 0 ||
        patch.cobertura_pct > 100
      ) {
        throw new ObraSocialValidacionError(
          'cobertura_pct debe ser un entero entre 0 y 100',
        );
      }
      datosValidados.cobertura_pct = patch.cobertura_pct;
    }

    if (patch.activo !== undefined) {
      if (patch.activo !== 0 && patch.activo !== 1) {
        throw new ObraSocialValidacionError('activo debe ser 0 o 1');
      }
      datosValidados.activo = patch.activo;
    }

    try {
      this.repo.update(id, datosValidados);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err.message.includes('UNIQUE') ||
          err.message.includes('SQLITE_CONSTRAINT'))
      ) {
        throw new ObraSocialConflictoError(
          'La combinación obra social y plan ya existe',
        );
      }
      throw err;
    }

    return this.repo.buscarPorIdVigente(id)!;
  }

  darDeBaja(id: string): void {
    const ok = this.repo.darDeBaja(id);
    if (!ok) {
      throw new ObraSocialNotFoundError('Plan de obra social no encontrado');
    }
  }
}
