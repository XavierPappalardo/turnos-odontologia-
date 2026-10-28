/**
 * CLI de seed (dev/demo): core ficticio + usuarios de los tres roles.
 * Requiere `SEED_PASSWORD` en el entorno; NUNCA se hardcodea una contraseña.
 */
import { loadConfig } from './config.js';
import { openDatabase } from './repository.js';
import { seedMinimo, seedUsuarios } from './seed.js';

const config = loadConfig();
const password = process.env['SEED_PASSWORD'];
if (password === undefined || password.length < 8) {
  throw new Error('SEED_PASSWORD es requerida (mínimo 8 caracteres)');
}

const db = openDatabase(config.databasePath);
try {
  seedMinimo(db);
  seedUsuarios(db, password);
  process.stdout.write('seed completado: datos ficticios cargados\n');
} finally {
  db.close();
}
