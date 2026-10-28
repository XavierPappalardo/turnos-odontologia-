/**
 * Bootstrap del servidor (design D6): `listen` sobre `PORT` y cierre ordenado
 * (`SIGINT`/`SIGTERM` → cerrar HTTP → cerrar `DatabaseSync`). No cambia la firma
 * de `createApp(db)`. `startServer(env)` es inyectable en tests.
 */
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger, defaultSink } from './logger.js';
import { openDatabase } from './repository.js';

export interface RunningServer {
  readonly httpServer: Server;
  /** Puerto realmente escuchado (útil cuando se arranca en puerto efímero 0). */
  port(): number;
  close(): Promise<void>;
}

function boundPort(server: Server, fallback: number): number {
  const address = server.address();
  return typeof address === 'object' && address !== null ? address.port : fallback;
}

export function startServer(env: NodeJS.ProcessEnv = process.env): RunningServer {
  const config = loadConfig(env);
  const logger = createLogger(defaultSink);
  const db = openDatabase(config.databasePath);
  const app = createApp(db, config);

  const httpServer = app.listen(config.port, () => {
    logger.info('server listening', {
      port: boundPort(httpServer, config.port),
      env: config.nodeEnv,
    });
  });

  let closing = false;
  const close = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      if (closing) {
        resolve();
        return;
      }
      closing = true;
      httpServer.close((err) => {
        try {
          db.close();
        } catch {
          // la BD ya está cerrada: ignorar
        }
        if (err) reject(err);
        else resolve();
      });
    });

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info('shutdown', { signal });
    close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  return { httpServer, port: () => boundPort(httpServer, config.port), close };
}
