/**
 * Seed mínimo con datos estrictamente ficticios (C-02/C-03; R1/R12).
 * Idempotente: puede ejecutarse varias veces sin duplicar filas.
 */
import type { DatabaseSync } from 'node:sqlite';
import { UsuarioRepository } from '../auth/auth.repository.js';
import { hashPassword } from '../auth/password.js';
import type {
  ObraSocialPlanRow,
  PacienteRow,
  PrestacionRow,
  ProfesionalRow,
  SillonRow,
} from '../core/models.js';
import { BaseRepository, UnitOfWork } from './repository.js';
import type { Rol, UsuarioId } from './types.js';

export const SEED_IDS = {
  profesional: 'prof-seed-0001',
  sillon: 'sillon-seed-0001',
  paciente: 'pac-seed-0001',
  prestacion: 'prest-seed-0001',
  obraSocialPlan: 'os-seed-0001',
  usuarioAdmin: 'user-seed-admin',
  usuarioRecepcion: 'user-seed-recepcion',
  usuarioProfesional: 'user-seed-profesional',
} as const;

/** Carga profesionales, sillón, prestación, OS/plan y paciente ficticios. */
export function seedMinimo(db: DatabaseSync): void {
  const uow = new UnitOfWork(db);
  uow.runInTransaction(() => {
    const os = new BaseRepository<ObraSocialPlanRow>(db, 'obra_social_plan');
    os.insertOrIgnore({
      id: SEED_IDS.obraSocialPlan,
      obra_social: 'Obra Social Ficticia',
      plan: 'Plan Ficticio 100',
      cobertura_pct: 100,
      activo: 1,
      deleted_at: null,
    });

    const profesionales = new BaseRepository<ProfesionalRow>(db, 'profesional');
    profesionales.insertOrIgnore({
      id: SEED_IDS.profesional,
      nombre: 'Profesional Ficticio',
      matricula: 'MAT-FICTICIA-0001',
      especialidad: 'Odontología Ficticia',
      activo: 1,
      deleted_at: null,
    });

    const sillones = new BaseRepository<SillonRow>(db, 'sillon');
    sillones.insertOrIgnore({
      id: SEED_IDS.sillon,
      nombre: 'Sillón Ficticio 1',
      activo: 1,
      deleted_at: null,
    });

    const prestaciones = new BaseRepository<PrestacionRow>(db, 'prestacion');
    prestaciones.insertOrIgnore({
      id: SEED_IDS.prestacion,
      codigo: 'PREST-FICTICIA-01',
      nombre: 'Consulta Ficticia',
      duracion_min: 30,
      activo: 1,
      deleted_at: null,
    });

    const pacientes = new BaseRepository<PacienteRow>(db, 'paciente');
    pacientes.insertOrIgnore({
      id: SEED_IDS.paciente,
      nombre: 'Paciente Ficticio Ejemplo',
      telefono_whatsapp: '+54 9 11 0000-0000',
      obra_social_plan_id: SEED_IDS.obraSocialPlan,
      activo: 1,
      deleted_at: null,
    });
  });
}

export interface SeedUsuario {
  id: UsuarioId;
  email: string;
  roles: readonly Rol[];
}

/** Usuarios ficticios de los tres roles (C-03). Requiere una contraseña de seed. */
export function seedUsuarios(db: DatabaseSync, password: string): void {
  const usuarios = new UsuarioRepository(db);
  const usuariosSeed: readonly SeedUsuario[] = [
    {
      id: SEED_IDS.usuarioAdmin as UsuarioId,
      email: 'admin@example.test',
      roles: ['administracion'],
    },
    {
      id: SEED_IDS.usuarioRecepcion as UsuarioId,
      email: 'recepcion@example.test',
      roles: ['recepcion'],
    },
    {
      id: SEED_IDS.usuarioProfesional as UsuarioId,
      email: 'profesional@example.test',
      roles: ['profesional'],
    },
  ];

  for (const usuario of usuariosSeed) {
    if (usuarios.findByEmail(usuario.email) !== undefined) continue;
    usuarios.crear({
      id: usuario.id,
      email: usuario.email,
      passwordHash: hashPassword(password),
      roles: usuario.roles,
    });
  }
}
