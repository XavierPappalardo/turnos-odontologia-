/**
 * C-20 demo/migración: servicio (BAJO). SQLite real (R12), ficticio (R1), sin PHI en reportes operativos.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { seedMinimo, SEED_IDS } from '../src/shared/seed.js';
import { DemoMigracionService } from '../src/utilidades/demo-migracion-excel/service.js';

let db: DatabaseSync;
let svc: DemoMigracionService;

function count(tabla: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as { n: number }).n;
}

describe('C-20 DemoMigracionService', () => {
  beforeEach(() => {
    db = openDatabase(':memory:');
    svc = new DemoMigracionService(db);
  });
  afterEach(() => db.close());

  it('Dado DB vacía Cuando carga demo Entonces crea datos ficticios e idempotente', () => {
    expect(count('profesional')).toBe(0);
    const r1 = svc.cargarDemo();
    expect(r1.ok).toBe(true);
    const n = count('profesional');
    expect(n).toBeGreaterThan(0);
    svc.cargarDemo();
    expect(count('profesional')).toBe(n);
    const nombre = (db.prepare('SELECT nombre FROM profesional WHERE id=?').get(SEED_IDS.profesional) as any).nombre;
    expect(nombre).toContain('Ficticio');
  });

  it('Dado profesionales CSV válidos Cuando preview Entonces no persiste y reporta válidos', async () => {
    const csv = 'id,nombre,matricula\nprof-mig-1,Profesional Ficticio Mig 1,MAT-M1\nprof-mig-2,Profesional Ficticio Mig 2,MAT-M2\n';
    const antes = count('profesional');
    const res = await svc.preview({ entidad: 'profesionales', formato: 'csv', contenido: csv });
    expect(res.persistido).toBe(false);
    expect(res.totalFilas).toBe(2);
    expect(res.filasValidas).toBe(2);
    expect(res.filasInvalidas).toBe(0);
    expect(count('profesional')).toBe(antes);
  });

  it('Dado CSV con fila inválida Cuando preview Entonces reporta errores tipados sin persistir', async () => {
    const csv = 'id,nombre\nprof-bad,\n';
    const res = await svc.preview({ entidad: 'profesionales', formato: 'csv', contenido: csv });
    expect(res.persistido).toBe(false);
    expect(res.filasInvalidas).toBe(1);
    expect(res.errores.some((e) => e.codigo === 'campo_requerido')).toBe(true);
    expect(count('profesional')).toBe(0);
  });

  it('Dado profesionales válidos Cuando confirma Entonces persiste y reporta', async () => {
    const csv = 'id,nombre\nprof-c-1,Profesional Ficticio C1\nprof-c-2,Profesional Ficticio C2\n';
    const res = await svc.confirmar({ entidad: 'profesionales', formato: 'csv', contenido: csv });
    expect(res.insertadas).toBe(2);
    expect(res.rechazadas).toBe(0);
    expect(count('profesional')).toBe(2);
  });

  it('Dado mezcla válida/inválida Cuando confirma Entonces persiste válidas y rechaza inválidas sin corromper', async () => {
    const csv = 'id,nombre\nprof-ok,Profesional Ficticio OK\nprof-bad,\n';
    const res = await svc.confirmar({ entidad: 'profesionales', formato: 'csv', contenido: csv });
    expect(res.insertadas).toBe(1);
    expect(res.errores.length).toBeGreaterThan(0);
    expect(count('profesional')).toBe(1);
  });

  it('Dado turno con referencias inexistentes Cuando preview Entonces rechaza con motivo tipado', async () => {
    seedMinimo(db);
    const csv = 'id,profesional_id,sillon_id,paciente_id,inicio,fin,estado\nturn-x,no-prof,no-sil,no-pac,2099-01-01T10:00:00.000Z,2099-01-01T10:30:00.000Z,atendido\n';
    const res = await svc.preview({ entidad: 'turnos', formato: 'csv', contenido: csv });
    expect(res.filasInvalidas).toBe(1);
    expect(res.errores.some((e) => e.codigo === 'referencia_inexistente')).toBe(true);
  });

  it('Dado turno activo solapado en DB Cuando confirma Entonces rechaza fila sin persistir turno inválido', async () => {
    seedMinimo(db);
    db.prepare(`INSERT INTO turno (id, profesional_id, sillon_id, paciente_id, inicio, fin, estado, origen, created_at, updated_at)
      VALUES ('t-exist','${SEED_IDS.profesional}','${SEED_IDS.sillon}','${SEED_IDS.paciente}','2099-06-01T10:00:00.000Z','2099-06-01T10:30:00.000Z','reservado','recepcion','2099-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z')`).run();
    const csv = `id,profesional_id,sillon_id,paciente_id,inicio,fin,estado\nt-solape,${SEED_IDS.profesional},${SEED_IDS.sillon},${SEED_IDS.paciente},2099-06-01T10:10:00.000Z,2099-06-01T10:40:00.000Z,reservado\n`;
    const antes = count('turno');
    const res = await svc.confirmar({ entidad: 'turnos', formato: 'csv', contenido: csv });
    expect(res.insertadas).toBe(0);
    expect(res.errores.some((e) => e.codigo === 'solapamiento')).toBe(true);
    expect(count('turno')).toBe(antes);
  });

  it('Dado turno histórico válido Cuando confirma Entonces persiste (sin ocupar agenda activa)', async () => {
    seedMinimo(db);
    const csv = `id,profesional_id,sillon_id,paciente_id,inicio,fin,estado\nt-hist,${SEED_IDS.profesional},${SEED_IDS.sillon},${SEED_IDS.paciente},2099-07-01T10:00:00.000Z,2099-07-01T10:30:00.000Z,atendido\n`;
    const res = await svc.confirmar({ entidad: 'turnos', formato: 'csv', contenido: csv });
    expect(res.insertadas).toBe(1);
    const row = db.prepare('SELECT estado FROM turno WHERE id=?').get('t-hist') as { estado: string };
    expect(row.estado).toBe('atendido');
  });

  it('Dado formato no soportado Cuando preview Entonces error tipado seguro', async () => {
    await expect(svc.preview({ entidad: 'pacientes', formato: 'pdf', contenido: 'x' } as any)).rejects.toMatchObject({ status: 400 });
  });
});
