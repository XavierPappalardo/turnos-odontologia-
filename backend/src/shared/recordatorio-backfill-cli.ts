/**
 * CLI de backfill de recordatorios (c-07-fix, design D9): programa los hitos
 * T-48h/T-24h de los turnos futuros activos de una base ya existente.
 * Idempotente: puede correrse más de una vez sin duplicar filas.
 */
import { programarRecordatoriosDeTurnosFuturos } from '../notificaciones/recordatorio.worker.js';
import { loadConfig } from './config.js';
import { openDatabase } from './repository.js';

const config = loadConfig();
const db = openDatabase(config.databasePath);
try {
  const turnos = programarRecordatoriosDeTurnosFuturos(
    db,
    config.recordatorio,
    new Date().toISOString(),
  );
  // Log operativo sin PHI (R3): sólo conteos, sin ids de pacientes.
  process.stdout.write(`backfill recordatorios: ${turnos} turnos futuros procesados\n`);
} finally {
  db.close();
}
