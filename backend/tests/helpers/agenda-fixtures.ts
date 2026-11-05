/**
 * Fixtures compartidos de agenda (C-08, task 6.4).
 * SQLite real en memoria y datos estrictamente ficticios (R1/R12).
 * Sin PHI: nombres y motivos de ejemplo son ficticios (R3).
 */
import type { DatabaseSync } from 'node:sqlite';
import { signToken } from '../../src/auth/tokens.js';
import type { AuthConfig } from '../../src/auth/types.js';
import type { AppConfig } from '../../src/shared/config.js';
import type { BloqueoId, Rol, TurnoId } from '../../src/shared/types.js';

export const AUTH: AuthConfig = {
  jwtSecret: 'test-secret-con-mas-de-32-caracteres-c08',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 604_800,
  loginRateLimitMax: 50,
  loginRateLimitWindowSeconds: 60,
  cookieSecure: false,
};

export const APP_CONFIG: AppConfig = {
  ...AUTH,
  port: 0,
  databasePath: ':memory:',
  nodeEnv: 'test',
  reservaOnline: {
    anticipacionMinSegundos: 7200,
    rateMax: 1000,
    rateWindowSeconds: 60,
    turnoTokenTtlSeconds: 7 * 24 * 60 * 60,
  },
  recordatorio: {
    t48hHoras: 48,
    t24hHoras: 24,
    canalPredeterminado: 'whatsapp',
  },
  caja: {
    zonaHoraria: 'America/Buenos_Aires',
  },
  mercadopago: {
    habilitado: false,
    ambiente: 'sandbox',
    token: null,
    webhookSecret: null,
  },
};

export function bearer(roles: readonly Rol[]): string {
  const token = signToken(
    {
      sub: 'user-test-c08',
      tenantId: 'test',
      roles,
      email: 'bloqueos@example.test',
      type: 'access',
      ttlSeconds: 900,
    },
    AUTH.jwtSecret,
  );
  return `Bearer ${token}`;
}

// ── Fixtures ficticios (R1/R12) ────────────────────────────────────────────
export const PROF = 'prof-0001';
export const PROF2 = 'prof-0002';
export const SILLA = 'sillon-0001';
export const SILLA2 = 'sillon-0002';
export const PAC = 'pac-0001';

let secuencia = 0;

export function resetSecuencia(): void {
  secuencia = 0;
}

export function idUnico(prefijo: string): string {
  secuencia += 1;
  return `${prefijo}-${secuencia}`;
}

export function seedBase(db: DatabaseSync): void {
  const now = new Date().toISOString();
  for (const [id, nombre] of [
    [PROF, 'Prof Ficticio Uno'],
    [PROF2, 'Prof Ficticia Dos'],
  ] as const) {
    db.prepare(
      `INSERT INTO profesional (id, nombre, activo, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`,
    ).run(id, nombre, now, now);
  }
  for (const [id, nombre] of [
    [SILLA, 'Sillon Ficticio 1'],
    [SILLA2, 'Sillon Ficticio 2'],
  ] as const) {
    db.prepare(
      `INSERT INTO sillon (id, nombre, activo, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`,
    ).run(id, nombre, now, now);
  }
  db.prepare(
    `INSERT INTO paciente (id, nombre, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  ).run(PAC, 'Paciente Ficticio Ejemplo', now, now);
}

export interface TurnoFixture {
  prof?: string;
  sillon?: string;
  inicio: string;
  fin: string;
  estado?: string;
  deletedAt?: string | null;
}

export function sembrarTurno(
  db: DatabaseSync,
  args: TurnoFixture,
): TurnoId {
  const now = new Date().toISOString();
  const id = idUnico('turno');
  db.prepare(
    `INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'recepcion', ?, ?, ?)`,
  ).run(
    id,
    args.prof ?? PROF,
    args.sillon ?? SILLA,
    PAC,
    args.inicio,
    args.fin,
    args.estado ?? 'reservado',
    now,
    now,
    args.deletedAt ?? null,
  );
  return id as TurnoId;
}

export interface BloqueoFixture {
  prof?: string | null;
  sillon?: string | null;
  inicio: string;
  fin: string;
  deletedAt?: string | null;
}

export function sembrarBloqueo(
  db: DatabaseSync,
  args: BloqueoFixture,
): BloqueoId {
  const now = new Date().toISOString();
  const id = idUnico('bloq');
  db.prepare(
    `INSERT INTO bloqueo (id, profesional_id, sillon_id, inicio, fin, motivo, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, 'motivo ficticio', ?, ?, ?)`,
  ).run(
    id,
    args.prof ?? null,
    args.sillon ?? null,
    args.inicio,
    args.fin,
    now,
    now,
    args.deletedAt ?? null,
  );
  return id as BloqueoId;
}
