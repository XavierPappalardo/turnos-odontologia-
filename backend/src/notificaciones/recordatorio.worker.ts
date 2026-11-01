/**
 * Servicio recordatorio (C-07): programa, procesa y cancela recordatorios
 * automáticos (T-48h / T-24h) de turnos. Reutiliza UnitOfWork (BEGIN IMMEDIATE)
 * para atomicidad y TurnoRepository para consultas de turno.
 * Errores sin PHI (solo ids opacos). No requiere autenticación JWT.
 */
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { UnitOfWork } from '../shared/repository.js';
import type { RecordatorioConfig } from '../shared/config.js';
import { TurnoRepository } from '../agenda/turno.repository.js';

export type TipoRecordatorio = 'recordatorio_48h' | 'recordatorio_24h';
export type CanalRecordatorio = 'whatsapp' | 'email';
export type EstadoRecordatorio = 'pendiente' | 'enviado' | 'fallido' | 'cancelado';

export interface RecordatorioRow {
  id: string;
  turno_id: string;
  tipo: TipoRecordatorio;
  canal: CanalRecordatorio;
  programado_para: string;
  estado: EstadoRecordatorio;
  enviado_en: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecordatorioProcesado {
  id: string;
  turno_id: string;
  tipo: TipoRecordatorio;
  estado: EstadoRecordatorio;
}

const AHORA = (): string => new Date().toISOString();

function minutosEntre(fecha1: string, fecha2: string): number {
  return (new Date(fecha2).getTime() - new Date(fecha1).getTime()) / 1000 / 60;
}

/**
 * Programa recordatorios T-48h y T-24h para un turno, solo si su fecha programada
 * está en el futuro. Evita duplicados por (turno_id, tipo).
 */
export function programarRecordatoriosParaTurno(
  db: DatabaseSync,
  turnoId: string,
  inicioTurno: string,
  config: RecordatorioConfig,
): void {
  const uow = new UnitOfWork(db);
  uow.runInTransaction(() => {
    const ahora = AHORA();
    const turnos = new TurnoRepository(db);
    const turno = turnos.findById(turnoId);
    if (turno === undefined) {
      // Turno inexistente: no hay recordatorios que programar.
      return;
    }

    const programaciones: Array<{ tipo: TipoRecordatorio; horas: number }> = [
      { tipo: 'recordatorio_48h', horas: config.t48hHoras },
      { tipo: 'recordatorio_24h', horas: config.t24hHoras },
    ];

    for (const { tipo, horas } of programaciones) {
      const programadoPara = new Date(
        new Date(inicioTurno).getTime() - horas * 60 * 60 * 1000,
      ).toISOString();

      // Solo crear si la fecha programada está en el futuro.
      if (programadoPara <= ahora) continue;

      // Evitar duplicados por (turno_id, tipo).
      const existente = db
        .prepare(
          `SELECT 1 FROM recordatorio WHERE turno_id = ? AND tipo = ? LIMIT 1`,
        )
        .get(turnoId, tipo) as { id: string } | undefined;
      if (existente !== undefined) continue;

      const id = randomUUID();
      const ahoraIso = AHORA();
      db.prepare(
        `INSERT INTO recordatorio (id, turno_id, tipo, canal, programado_para, estado, enviado_en, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pendiente', NULL, ?, ?)`,
      ).run(
        id,
        turnoId,
        tipo,
        config.canalPredeterminado,
        programadoPara,
        ahoraIso,
        ahoraIso,
      );
    }
  });
}

/**
 * Procesa recordatorios pendientes cuya fecha programada ya llegó. Marca cada uno
 * como 'enviado' (simulación de envío; sin credenciales reales de WhatsApp).
 * Cada recordatorio se procesa en su propia transacción BEGIN IMMEDIATE.
 */
export function procesarRecordatoriosPendientes(
  db: DatabaseSync,
  _config: RecordatorioConfig,
): RecordatorioProcesado[] {
  const ahora = AHORA();
  const pendientes = db
    .prepare(
      `SELECT id, turno_id, tipo, estado FROM recordatorio
       WHERE estado = 'pendiente' AND programado_para <= ?`,
    )
    .all(ahora) as unknown as RecordatorioRow[];

  const procesados: RecordatorioProcesado[] = [];

  for (const recordatorio of pendientes) {
    const uow = new UnitOfWork(db);
    uow.runInTransaction(() => {
      db.prepare(
        `UPDATE recordatorio
           SET estado = 'enviado', enviado_en = ?, updated_at = ?
         WHERE id = ? AND estado = 'pendiente'`,
      ).run(ahora, ahora, recordatorio.id);
    });

    procesados.push({
      id: recordatorio.id,
      turno_id: recordatorio.turno_id,
      tipo: recordatorio.tipo,
      estado: 'enviado',
    });

    // Log operativo sin PHI (R3): solo ids opacos.
    // eslint-disable-next-line no-console
    console.log(
      `recordatorio enviado id=${recordatorio.id} turno=${recordatorio.turno_id} tipo=${recordatorio.tipo}`,
    );
  }

  return procesados;
}

/**
 * Cancela los recordatorios pendientes de un turno (cuando el turno se cancela,
 * se marca ausente o se reprograma). Se llama desde los servicios de C-06.
 */
export function cancelarRecordatoriosDeTurno(
  db: DatabaseSync,
  turnoId: string,
): void {
  const ahora = AHORA();
  db.prepare(
    `UPDATE recordatorio
       SET estado = 'cancelado', updated_at = ?
     WHERE turno_id = ? AND estado = 'pendiente'`,
  ).run(ahora, turnoId);
}

/**
 * Lista recordatorios con estado 'pendiente' (para el endpoint público
 * GET /api/public/recordatorios/pendientes).
 */
export function listarRecordatoriosPendientes(
  db: DatabaseSync,
): RecordatorioRow[] {
  return db
    .prepare(
      `SELECT id, turno_id, tipo, canal, programado_para, estado, enviado_en, created_at, updated_at
       FROM recordatorio
       WHERE estado = 'pendiente'
       ORDER BY programado_para ASC`,
    )
    .all() as unknown as RecordatorioRow[];
}
