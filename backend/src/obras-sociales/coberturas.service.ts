/**
 * Servicio de coberturas de obras sociales (C-12, RN-07).
 * Cálculo con BigInt y truncamiento entero (Q1).
 * Transacciones BEGIN IMMEDIATE con UnitOfWork (R9).
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ObraSocialPlanRepository } from '../core/obraSocialPlan.repository.js';
import { UnitOfWork } from '../shared/repository.js';
import type { Rol } from '../shared/types.js';
import {
  CoberturaRepository,
  type CoberturaTurnoRow,
} from './cobertura.repository.js';
import {
  ObraSocialConflictoError,
  ObraSocialForbiddenError,
  ObraSocialNotFoundError,
  ObraSocialValidacionError,
} from './errors.js';

export class MontoNoRepresentableError extends ObraSocialValidacionError {
  constructor(message = 'monto no representable') {
    super(message, 'monto_no_representable');
    this.name = 'MontoNoRepresentableError';
  }
}

export class ValidacionCoberturaError extends ObraSocialValidacionError {
  constructor(message: string, code = 'validacion') {
    super(message, code);
    this.name = 'ValidacionCoberturaError';
  }
}

export interface CalculoCoberturaResultado {
  cobertura_centavos: number;
  saldo_paciente_centavos: number;
}

/**
 * Función pura de cálculo RN-07:
 * - Valida entradas enteras seguras (R2, R5, R6)
 * - Multiplicación y división en BigInt con truncamiento (Q1)
 * - Verificación de que el resultado sea convertible a Number seguro
 */
export function calcularCobertura(
  montoTotalCentavos: number,
  coberturaPct: number,
): CalculoCoberturaResultado {
  if (
    typeof montoTotalCentavos !== 'number' ||
    !Number.isInteger(montoTotalCentavos) ||
    montoTotalCentavos < 0
  ) {
    throw new ValidacionCoberturaError(
      'monto_total_centavos debe ser un entero mayor o igual a 0',
    );
  }

  if (!Number.isSafeInteger(montoTotalCentavos)) {
    throw new MontoNoRepresentableError(
      'monto_total_centavos excede Number.MAX_SAFE_INTEGER',
    );
  }

  if (
    typeof coberturaPct !== 'number' ||
    !Number.isInteger(coberturaPct) ||
    coberturaPct < 0 ||
    coberturaPct > 100
  ) {
    throw new ValidacionCoberturaError(
      'cobertura_pct debe ser un entero entre 0 y 100',
    );
  }

  const montoBig = BigInt(montoTotalCentavos);
  const pctBig = BigInt(coberturaPct);
  const coberturaBig = (montoBig * pctBig) / 100n;

  if (coberturaBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MontoNoRepresentableError(
      'cobertura_centavos calculada excede Number.MAX_SAFE_INTEGER',
    );
  }

  const cobertura_centavos = Number(coberturaBig);
  const saldo_paciente_centavos = montoTotalCentavos - cobertura_centavos;

  return {
    cobertura_centavos,
    saldo_paciente_centavos,
  };
}

export interface RegistrarCoberturaInput {
  turno_id: string;
  monto_total_centavos: number;
  obra_social_plan_id?: string;
  [key: string]: unknown;
}

const ALLOWLIST_REGISTRAR_COBERTURA = [
  'turno_id',
  'monto_total_centavos',
  'obra_social_plan_id',
] as const;

export class CoberturasService {
  private readonly repo: CoberturaRepository;
  private readonly planRepo: ObraSocialPlanRepository;
  private readonly uow: UnitOfWork;

  constructor(db: DatabaseSync) {
    this.repo = new CoberturaRepository(db);
    this.planRepo = new ObraSocialPlanRepository(db);
    this.uow = new UnitOfWork(db);
  }

  registrarCobertura(
    input: RegistrarCoberturaInput,
  ): CoberturaTurnoRow {
    // Validar allowlist estricta
    for (const key of Object.keys(input)) {
      if (
        !ALLOWLIST_REGISTRAR_COBERTURA.includes(
          key as (typeof ALLOWLIST_REGISTRAR_COBERTURA)[number],
        )
      ) {
        throw new ValidacionCoberturaError(
          `Campo no permitido en registro de cobertura: ${key}`,
        );
      }
    }

    if (!input.turno_id || typeof input.turno_id !== 'string') {
      throw new ValidacionCoberturaError('turno_id es requerido');
    }

    // 1. Obtener y validar el turno (lecturas de apoyo via repositorio, R8)
    const turno = this.repo.buscarTurnoPorId(input.turno_id);

    if (!turno || turno.deleted_at !== null) {
      throw new ObraSocialNotFoundError('Turno no encontrado');
    }

    if (!turno.prestacion_id) {
      throw new ValidacionCoberturaError('El turno no tiene prestación asignada');
    }

    // 2. Obtener paciente y su plan (via repositorio, R8)
    const paciente = this.repo.buscarPacientePorId(turno.paciente_id);

    if (!paciente || paciente.deleted_at !== null) {
      throw new ObraSocialNotFoundError('Paciente no encontrado');
    }

    let planIdDeterminado: string;
    if (input.obra_social_plan_id !== undefined) {
      // Si el paciente tiene plan asignado y difiere -> 400
      if (
        paciente.obra_social_plan_id &&
        paciente.obra_social_plan_id !== input.obra_social_plan_id
      ) {
        throw new ValidacionCoberturaError(
          'El plan declarado difiere del asignado al paciente',
        );
      }
      planIdDeterminado = input.obra_social_plan_id;
    } else {
      if (!paciente.obra_social_plan_id) {
        throw new ValidacionCoberturaError(
          'El paciente no tiene obra social asignada',
        );
      }
      planIdDeterminado = paciente.obra_social_plan_id;
    }

    // 3. Verificar existencia del plan vigente
    const plan = this.planRepo.buscarPorIdVigente(planIdDeterminado);
    if (!plan || plan.activo === 0) {
      throw new ValidacionCoberturaError('Plan de obra social inexistente o no vigente');
    }

    // 4. Calcular cobertura con BigInt puro (Q1)
    const calculo = calcularCobertura(
      input.monto_total_centavos,
      plan.cobertura_pct,
    );

    // 5. Inserción transaccional BEGIN IMMEDIATE con UnitOfWork
    return this.uow.runInTransaction(() => {
      const existente = this.repo.buscarPorTurnoIdVigente(input.turno_id);
      if (existente) {
        throw new ObraSocialConflictoError(
          'Ya existe una cobertura vigente para este turno',
        );
      }

      const id = randomUUID();
      const row: CoberturaTurnoRow = {
        id,
        turno_id: turno.id,
        prestacion_id: turno.prestacion_id!,
        obra_social_plan_id: plan.id,
        monto_total_centavos: input.monto_total_centavos,
        cobertura_pct: plan.cobertura_pct,
        cobertura_centavos: calculo.cobertura_centavos,
        saldo_paciente_centavos: calculo.saldo_paciente_centavos,
        moneda: 'ARS',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
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
            'Ya existe una cobertura para este turno',
          );
        }
        throw err;
      }

      return this.repo.buscarPorIdVigente(id)!;
    });
  }

  actualizarMonto(
    id: string,
    body: Record<string, unknown>,
  ): CoberturaTurnoRow {
    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== 'monto_total_centavos') {
      throw new ValidacionCoberturaError(
        'PATCH solo permite monto_total_centavos',
      );
    }

    const nuevoMonto = body.monto_total_centavos;
    if (
      typeof nuevoMonto !== 'number' ||
      !Number.isInteger(nuevoMonto) ||
      nuevoMonto < 0
    ) {
      throw new ValidacionCoberturaError(
        'monto_total_centavos debe ser un entero >= 0',
      );
    }

    if (!Number.isSafeInteger(nuevoMonto)) {
      throw new MontoNoRepresentableError(
        'monto_total_centavos excede Number.MAX_SAFE_INTEGER',
      );
    }

    // F3 (obs. auditoría): TODA la operación corre DENTRO de la transacción:
    // re-lectura + guard de congelamiento + cálculo + patch atómicos, con
    // BEGIN IMMEDIATE serializando escritores (ni la cabecera ni el plan pueden
    // mudarse entre el guard y el patch).
    return this.uow.runInTransaction(() => {
      const cobertura = this.repo.buscarPorIdVigente(id);
      if (!cobertura) {
        throw new ObraSocialNotFoundError('Cobertura no encontrada');
      }

      // Guard de congelamiento (spec "Actualización controlada")
      if (this.repo.estaEnLiquidacionVigente(id)) {
        throw new ObraSocialConflictoError(
          'La cobertura ya está incluida en una liquidación vigente',
        );
      }

      // Buscar plan vigente para refrescar snapshot de porcentaje
      const plan = this.planRepo.buscarPorIdVigente(cobertura.obra_social_plan_id);
      const pct = plan ? plan.cobertura_pct : cobertura.cobertura_pct;

      const calculo = calcularCobertura(nuevoMonto, pct);

      // Patch comprobado (F3): sin filas afectadas (dada de baja
      // concurrentemente tras el guard) → error de dominio y DELETE/Rollback,
      // en lugar de éxito silencioso con cero filas.
      const ok = this.repo.update(id, {
        monto_total_centavos: nuevoMonto,
        cobertura_pct: pct,
        cobertura_centavos: calculo.cobertura_centavos,
        saldo_paciente_centavos: calculo.saldo_paciente_centavos,
      });
      if (!ok) {
        throw new ObraSocialNotFoundError('Cobertura no encontrada');
      }

      return this.repo.buscarPorIdVigente(id)!;
    });
  }

  obtenerPorId(
    id: string,
    rol: Rol,
    profesionalId: string | null = null,
  ): CoberturaTurnoRow {
    const cobertura = this.repo.buscarPorIdVigente(id);
    if (!cobertura) {
      throw new ObraSocialNotFoundError('Cobertura no encontrada');
    }

    if (rol === 'profesional') {
      const turno = this.repo.buscarTurnoPorId(cobertura.turno_id);

      if (!turno || turno.profesional_id !== profesionalId) {
        throw new ObraSocialForbiddenError(
          'No tiene acceso a coberturas de turnos ajenos',
        );
      }
    }

    return cobertura;
  }

  /**
   * Baja lógica del cargo (spec "Único cargo vigente por turno"): habilita la
   * re-emisión del cargo del mismo turno. F2 (obs. auditoría): guard
   * equivalente al de PATCH — si la cobertura está incluida en una liquidación
   * vigente responde 409 (congelamiento, aplicar escala del spec). Lectura,
   * guard y softDelete en UNA transacción: ninguna liquidación puede abrirse
   * intermedio y el snapshot histórico queda intacto (R9).
   */
  darDeBaja(id: string): void {
    this.uow.runInTransaction(() => {
      const cobertura = this.repo.buscarPorIdVigente(id);
      if (!cobertura) {
        throw new ObraSocialNotFoundError('Cobertura no encontrada');
      }

      if (this.repo.estaEnLiquidacionVigente(id)) {
        throw new ObraSocialConflictoError(
          'La cobertura ya está incluida en una liquidación vigente',
        );
      }

      const ok = this.repo.softDelete(id);
      if (!ok) {
        throw new ObraSocialNotFoundError('Cobertura no encontrada');
      }
    });
  }

  listar(rol: Rol, profesionalId: string | null = null): CoberturaTurnoRow[] {
    if (rol === 'profesional') {
      if (!profesionalId) return [];
      return this.repo.listarPorProfesional(profesionalId);
    }
    return this.repo.listarVigentes();
  }
}
