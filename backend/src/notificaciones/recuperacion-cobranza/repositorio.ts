/**
 * Repositorios C-18 (R8): segmentación, ejecuciones y contactos/dedupe. Sin PHI.
 */
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { UnitOfWork } from '../../shared/repository.js';

export interface PacienteInactivoRow {
  paciente_id: string;
  ultima_actividad_at: string | null;
}

export interface EjecucionRow {
  id: string;
  tipo: 'recuperacion' | 'cobranza';
  estado: 'iniciada' | 'completada' | 'fallida';
  parametros_json: string;
  resumen_json: string;
  actor_usuario_id: string | null;
  iniciado_en: string;
  finalizado_en: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactoRow {
  id: string;
  ejecucion_id: string;
  tipo: 'recuperacion' | 'cobranza';
  paciente_id: string;
  estado: 'enviado_simulado' | 'omitido' | 'fallido';
  motivo_omision: string | null;
  monto_centavos: number | null;
  dedupe_clave: string;
  ventana_hasta: string | null;
  detalle_json: string;
  created_at: string;
  updated_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class RecuperacionCobranzaRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** Criterio determinista: sin turno atendido en ventana => inactivo (incluye sin atendidos). */
  listarInactivos(inactividadDias: number, ahoraIso: string, limite: number): PacienteInactivoRow[] {
    const corte = new Date(new Date(ahoraIso).getTime() - inactividadDias * 24 * 60 * 60 * 1000).toISOString();
    return this.db
      .prepare(
        `SELECT p.id AS paciente_id, MAX(CASE WHEN t.estado = 'atendido' THEN t.inicio END) AS ultima_actividad_at
         FROM paciente p
         LEFT JOIN turno t ON t.paciente_id = p.id
         GROUP BY p.id
         HAVING ultima_actividad_at IS NULL OR ultima_actividad_at < ?
         ORDER BY ultima_actividad_at IS NULL DESC, ultima_actividad_at ASC, p.id ASC
         LIMIT ?`,
      )
      .all(corte, limite) as unknown as PacienteInactivoRow[];
  }

  crearEjecucion(tipo: 'recuperacion' | 'cobranza', actorUsuarioId: string | null, parametros: unknown): EjecucionRow {
    const uow = new UnitOfWork(this.db);
    return uow.runInTransaction(() => {
      const id = randomUUID();
      const ahora = nowIso();
      this.db
        .prepare(
          `INSERT INTO recuperacion_ejecucion (id,tipo,estado,parametros_json,resumen_json,actor_usuario_id,iniciado_en,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .run(id, tipo, 'iniciada', JSON.stringify(parametros ?? {}), '{}', actorUsuarioId, ahora, ahora, ahora);
      return this.obtenerEjecucion(id)!;
    });
  }

  finalizarEjecucion(id: string, estado: 'completada' | 'fallida', resumen: unknown): void {
    const uow = new UnitOfWork(this.db);
    uow.runInTransaction(() => {
      const ahora = nowIso();
      this.db
        .prepare(
          `UPDATE recuperacion_ejecucion SET estado=?, resumen_json=?, finalizado_en=?, updated_at=? WHERE id=?`,
        )
        .run(estado, JSON.stringify(resumen ?? {}), ahora, ahora, id);
    });
  }

  obtenerEjecucion(id: string): EjecucionRow | undefined {
    return this.db
      .prepare(`SELECT * FROM recuperacion_ejecucion WHERE id = ?`)
      .get(id) as EjecucionRow | undefined;
  }

  listarEjecuciones(tipo?: 'recuperacion' | 'cobranza', limite = 50): EjecucionRow[] {
    if (tipo) {
      return this.db
        .prepare(`SELECT * FROM recuperacion_ejecucion WHERE tipo = ? ORDER BY iniciado_en DESC LIMIT ?`)
        .all(tipo, limite) as unknown as EjecucionRow[];
    }
    return this.db
      .prepare(`SELECT * FROM recuperacion_ejecucion ORDER BY iniciado_en DESC LIMIT ?`)
      .all(limite) as unknown as EjecucionRow[];
  }

  contactoReciente(
    tipo: 'recuperacion' | 'cobranza',
    pacienteId: string,
    ventanaHoras: number,
    ahoraIso: string,
  ): ContactoRow | undefined {
    const corte = new Date(new Date(ahoraIso).getTime() - ventanaHoras * 60 * 60 * 1000).toISOString();
    return this.db
      .prepare(
        `SELECT * FROM recuperacion_contacto
         WHERE tipo = ? AND paciente_id = ? AND estado = 'enviado_simulado' AND created_at >= ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(tipo, pacienteId, corte) as ContactoRow | undefined;
  }

  registrarContacto(input: Omit<ContactoRow, 'id' | 'created_at' | 'updated_at'>): ContactoRow {
    const uow = new UnitOfWork(this.db);
    return uow.runInTransaction(() => {
      const id = randomUUID();
      const ahora = nowIso();
      this.db
        .prepare(
          `INSERT INTO recuperacion_contacto (id,ejecucion_id,tipo,paciente_id,estado,motivo_omision,monto_centavos,dedupe_clave,ventana_hasta,detalle_json,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          input.ejecucion_id,
          input.tipo,
          input.paciente_id,
          input.estado,
          input.motivo_omision ?? null,
          input.monto_centavos ?? null,
          input.dedupe_clave,
          input.ventana_hasta ?? null,
          input.detalle_json,
          ahora,
          ahora,
        );
      return this.db.prepare(`SELECT * FROM recuperacion_contacto WHERE id=?`).get(id) as unknown as ContactoRow;
    });
  }

  listarContactosPorEjecucion(ejecucionId: string): ContactoRow[] {
    return this.db
      .prepare(`SELECT * FROM recuperacion_contacto WHERE ejecucion_id = ? ORDER BY created_at ASC`)
      .all(ejecucionId) as unknown as ContactoRow[];
  }
}
