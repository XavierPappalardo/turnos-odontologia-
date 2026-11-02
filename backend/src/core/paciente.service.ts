/**
 * C-09 task 8.2: PacienteService.
 * `PATCH /api/pacientes/:id` - actualización de `fecha_nacimiento` y `alergias`
 * con allowlist estricta y permisos por rol (diseño D5, matriz D5).
 * Errores tipados sin PHI (R3).
 */
import type { DatabaseSync } from 'node:sqlite';
import { PacienteRepository } from './paciente.repository.js';

export interface PacienteActualizado {
  id: string;
  nombre: string;
  fecha_nacimiento: string | null;
  alergias: string | null;
}

type CampoClinico = 'fecha_nacimiento' | 'alergias';

const CAMPOS_PERMITIDOS: readonly CampoClinico[] = ['fecha_nacimiento', 'alergias'];

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Matriz D5: qué rol puede actualizar qué campo
const CAMPOS_POR_ROL: Record<string, readonly CampoClinico[]> = {
  recepcion: ['fecha_nacimiento'],
  profesional: ['alergias'],
  administracion: ['fecha_nacimiento'],
};

export type PacienteServiceResult =
  | { tipo: 'ok'; data: PacienteActualizado }
  | { tipo: 'not_found' }
  | { tipo: 'forbidden' }
  | { tipo: 'validacion' };

export class PacienteService {
  private readonly repo: PacienteRepository;

  constructor(db: DatabaseSync) {
    this.repo = new PacienteRepository(db);
  }

  actualizarDatosClinicos(
    pacienteId: string,
    datos: Record<string, unknown>,
    profesionalId: string | null,
    roles: readonly string[],
  ): PacienteServiceResult {
    const paciente = this.repo.findVigente(pacienteId);
    if (!paciente) return { tipo: 'not_found' };

    // Allowlist: solo fecha_nacimiento y alergias
    const campos = Object.keys(datos) as string[];
    for (const campo of campos) {
      if (!CAMPOS_PERMITIDOS.includes(campo as CampoClinico)) {
        return { tipo: 'validacion' };
      }
    }

    // Permisos por rol
    const rol = roles.find((r) => r in CAMPOS_POR_ROL);
    const camposPermitidosParaRol = rol ? CAMPOS_POR_ROL[rol] : [];
    for (const campo of campos) {
      if (!camposPermitidosParaRol.includes(campo as CampoClinico)) {
        return { tipo: 'forbidden' };
      }
    }

    // Validar y normalizar valores
    const actualizar: Record<string, string | null> = {};
    for (const [campo, valor] of Object.entries(datos)) {
      if (campo === 'fecha_nacimiento') {
        const fecha = this.validarFechaNacimiento(valor);
        if (fecha === undefined) return { tipo: 'validacion' };
        actualizar.fecha_nacimiento = fecha;
      } else if (campo === 'alergias') {
        const alergias = this.validarAlergias(valor);
        if (alergias === undefined) return { tipo: 'validacion' };
        actualizar.alergias = alergias;
      }
    }

    const ok = this.repo.actualizarDatosClinicos(pacienteId, actualizar);
    if (!ok) return { tipo: 'not_found' };

    return {
      tipo: 'ok',
      data: {
        id: paciente.id,
        nombre: paciente.nombre,
        fecha_nacimiento: actualizar.fecha_nacimiento ?? paciente.fecha_nacimiento,
        alergias: actualizar.alergias ?? paciente.alergias,
      },
    };
  }

  private validarFechaNacimiento(valor: unknown): string | undefined {
    if (typeof valor !== 'string') return undefined;
    if (!FECHA_REGEX.test(valor)) return undefined;
    const fecha = new Date(valor + 'T00:00:00.000Z');
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    if (fecha > hoy) return undefined;
    return valor;
  }

  private validarAlergias(valor: unknown): string | null | undefined {
    if (typeof valor !== 'string') return undefined;
    if (valor.trim() === '') return null;
    if (valor.length > 2000) return undefined;
    return valor;
  }
}
