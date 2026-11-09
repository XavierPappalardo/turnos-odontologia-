/**
 * Servicio recuperación/cobranza (C-18). Segmentación, campañas y cobranza automática.
 * Read-only respecto de caja; envío simulado sin credenciales; sin PHI en logs/errores.
 */
import type { DatabaseSync } from 'node:sqlite';
import { AppError } from '../../shared/errors.js';
import type { AppConfig } from '../../shared/config.js';
import { CajaService } from '../../caja/caja.service.js';
import { enviarSimulado } from './adapter.js';
import { RecuperacionCobranzaRepository } from './repositorio.js';

export interface SegmentoInactivosResultado {
  habilitado: boolean;
  inactividad_dias: number;
  total: number;
  pacientes: Array<{ paciente_id: string; ultima_actividad_at: string | null }>;
}

export interface EjecucionResumen {
  id: string;
  tipo: 'recuperacion' | 'cobranza';
  estado: string;
  procesados: number;
  enviados: number;
  omitidos: number;
}

function configValida(config: AppConfig): boolean {
  const c = config.recuperacionCobranza;
  return (
    Number.isInteger(c.inactividadDias) &&
    c.inactividadDias > 0 &&
    Number.isInteger(c.recuperacionVentanaHoras) &&
    c.recuperacionVentanaHoras > 0 &&
    Number.isInteger(c.cobranzaVentanaHoras) &&
    c.cobranzaVentanaHoras > 0 &&
    Number.isInteger(c.maxContactosPorEjecucion) &&
    c.maxContactosPorEjecucion > 0
  );
}

function dedupeClave(tipo: 'recuperacion' | 'cobranza', pacienteId: string, ahoraIso: string): string {
  // Clave por día UTC para idempotencia operativa simple + ventana consultada aparte.
  const dia = ahoraIso.slice(0, 10);
  return `${tipo}:${pacienteId}:${dia}`;
}

export class RecuperacionCobranzaService {
  private readonly repo: RecuperacionCobranzaRepository;
  private readonly caja: CajaService;

  constructor(private readonly db: DatabaseSync, private readonly config: AppConfig) {
    this.repo = new RecuperacionCobranzaRepository(db);
    this.caja = new CajaService(db, { zonaHoraria: config.caja.zonaHoraria });
  }

  segmentarInactivos(ahoraIso = new Date().toISOString(), limite?: number): SegmentoInactivosResultado {
    if (!configValida(this.config)) {
      throw new AppError({ status: 400, code: 'validacion', message: 'configuración inválida' });
    }
    const c = this.config.recuperacionCobranza;
    if (!c.habilitado) {
      return { habilitado: false, inactividad_dias: c.inactividadDias, total: 0, pacientes: [] };
    }
    const max = Math.max(1, Math.min(limite ?? c.maxContactosPorEjecucion, c.maxContactosPorEjecucion));
    const rows = this.repo.listarInactivos(c.inactividadDias, ahoraIso, max);
    return {
      habilitado: true,
      inactividad_dias: c.inactividadDias,
      total: rows.length,
      pacientes: rows.map((r) => ({ paciente_id: r.paciente_id, ultima_actividad_at: r.ultima_actividad_at })),
    };
  }

  ejecutarRecuperacion(actorUsuarioId: string | null, ahoraIso = new Date().toISOString()): EjecucionResumen {
    if (!configValida(this.config)) {
      throw new AppError({ status: 400, code: 'validacion', message: 'configuración inválida' });
    }
    const c = this.config.recuperacionCobranza;
    if (!c.habilitado) {
      throw new AppError({ status: 409, code: 'conflicto', message: 'funcionalidad deshabilitada' });
    }
    const ejec = this.repo.crearEjecucion('recuperacion', actorUsuarioId, {
      inactividad_dias: c.inactividadDias,
      ventana_horas: c.recuperacionVentanaHoras,
    });
    let enviados = 0;
    let omitidos = 0;
    let procesados = 0;
    try {
      const segmento = this.repo.listarInactivos(c.inactividadDias, ahoraIso, c.maxContactosPorEjecucion);
      for (const obj of segmento) {
        procesados += 1;
        const reciente = this.repo.contactoReciente('recuperacion', obj.paciente_id, c.recuperacionVentanaHoras, ahoraIso);
        if (reciente) {
          omitidos += 1;
          this.repo.registrarContacto({
            ejecucion_id: ejec.id,
            tipo: 'recuperacion',
            paciente_id: obj.paciente_id,
            estado: 'omitido',
            motivo_omision: 'ventana_no_cumplida',
            monto_centavos: null,
            dedupe_clave: dedupeClave('recuperacion', obj.paciente_id, ahoraIso),
            ventana_hasta: null,
            detalle_json: '{}',
          });
          continue;
        }
        const ref = dedupeClave('recuperacion', obj.paciente_id, ahoraIso);
        enviarSimulado({ tipo: 'recuperacion', pacienteId: obj.paciente_id, referenciaOpaca: ref });
        enviados += 1;
        const ventanaHasta = new Date(new Date(ahoraIso).getTime() + c.recuperacionVentanaHoras * 3600_000).toISOString();
        this.repo.registrarContacto({
          ejecucion_id: ejec.id,
          tipo: 'recuperacion',
          paciente_id: obj.paciente_id,
          estado: 'enviado_simulado',
          motivo_omision: null,
          monto_centavos: null,
          dedupe_clave: ref,
          ventana_hasta: ventanaHasta,
          detalle_json: '{"canal":"simulado"}',
        });
      }
      this.repo.finalizarEjecucion(ejec.id, 'completada', { procesados, enviados, omitidos });
      return { id: ejec.id, tipo: 'recuperacion', estado: 'completada', procesados, enviados, omitidos };
    } catch (err) {
      this.repo.finalizarEjecucion(ejec.id, 'fallida', { procesados, enviados, omitidos });
      throw err;
    }
  }

  ejecutarCobranza(actorUsuarioId: string | null, ahoraIso = new Date().toISOString()): EjecucionResumen {
    if (!configValida(this.config)) {
      throw new AppError({ status: 400, code: 'validacion', message: 'configuración inválida' });
    }
    const c = this.config.recuperacionCobranza;
    if (!c.habilitado) {
      throw new AppError({ status: 409, code: 'conflicto', message: 'funcionalidad deshabilitada' });
    }
    const ejec = this.repo.crearEjecucion('cobranza', actorUsuarioId, {
      ventana_horas: c.cobranzaVentanaHoras,
    });
    let enviados = 0;
    let omitidos = 0;
    let procesados = 0;
    try {
      // Candidatos: pacientes con presupuestos aceptados (fuente read-only caja). Limitamos a max.
      const candidatos = this.db
        .prepare(
          `SELECT DISTINCT paciente_id FROM presupuesto WHERE estado = 'aceptado' AND deleted_at IS NULL ORDER BY paciente_id ASC LIMIT ?`,
        )
        .all(c.maxContactosPorEjecucion) as Array<{ paciente_id: string }>;
      for (const cand of candidatos) {
        procesados += 1;
        const deuda = this.caja.deudaPorPaciente(cand.paciente_id);
        if (deuda.deuda_total_centavos <= 0) {
          continue; // sin deuda pendiente: no genera contacto (spec 130-132)
        }
        const reciente = this.repo.contactoReciente('cobranza', cand.paciente_id, c.cobranzaVentanaHoras, ahoraIso);
        if (reciente) {
          omitidos += 1;
          this.repo.registrarContacto({
            ejecucion_id: ejec.id,
            tipo: 'cobranza',
            paciente_id: cand.paciente_id,
            estado: 'omitido',
            motivo_omision: 'ventana_no_cumplida',
            monto_centavos: deuda.deuda_total_centavos,
            dedupe_clave: dedupeClave('cobranza', cand.paciente_id, ahoraIso),
            ventana_hasta: null,
            detalle_json: JSON.stringify({ monto_centavos: deuda.deuda_total_centavos }),
          });
          continue;
        }
        const ref = dedupeClave('cobranza', cand.paciente_id, ahoraIso);
        enviarSimulado({ tipo: 'cobranza', pacienteId: cand.paciente_id, referenciaOpaca: ref });
        enviados += 1;
        const ventanaHasta = new Date(new Date(ahoraIso).getTime() + c.cobranzaVentanaHoras * 3600_000).toISOString();
        this.repo.registrarContacto({
          ejecucion_id: ejec.id,
          tipo: 'cobranza',
          paciente_id: cand.paciente_id,
          estado: 'enviado_simulado',
          motivo_omision: null,
          monto_centavos: deuda.deuda_total_centavos,
          dedupe_clave: ref,
          ventana_hasta: ventanaHasta,
          detalle_json: JSON.stringify({ canal: 'simulado', monto_centavos: deuda.deuda_total_centavos }),
        });
      }
      this.repo.finalizarEjecucion(ejec.id, 'completada', { procesados, enviados, omitidos });
      return { id: ejec.id, tipo: 'cobranza', estado: 'completada', procesados, enviados, omitidos };
    } catch (err) {
      this.repo.finalizarEjecucion(ejec.id, 'fallida', { procesados, enviados, omitidos });
      throw err;
    }
  }

  obtenerEjecucion(id: string) {
    const row = this.repo.obtenerEjecucion(id);
    if (!row) throw new AppError({ status: 404, code: 'not_found', message: 'recurso no encontrado' });
    return {
      ...row,
      parametros: safeJson(row.parametros_json),
      resumen: safeJson(row.resumen_json),
      contactos: this.repo.listarContactosPorEjecucion(id).map((c) => ({
        id: c.id,
        tipo: c.tipo,
        paciente_id: c.paciente_id,
        estado: c.estado,
        motivo_omision: c.motivo_omision,
        monto_centavos: c.monto_centavos,
        created_at: c.created_at,
      })),
    };
  }

  listarEjecuciones(tipo?: 'recuperacion' | 'cobranza') {
    return this.repo.listarEjecuciones(tipo).map((r) => ({
      id: r.id,
      tipo: r.tipo,
      estado: r.estado,
      iniciado_en: r.iniciado_en,
      finalizado_en: r.finalizado_en,
      resumen: safeJson(r.resumen_json),
    }));
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
