/**
 * Task 5.1: servicios de configuración de comisiones (C-13).
 * SQLite REAL en memoria (R12: sin mocks de transacción), UnitOfWork
 * `BEGIN IMMEDIATE` real, escenarios Dado/Cuando/Entonces (R11) y datos
 * estrictamente ficticios (R1/R12).
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { ComisionError } from '../src/shared/errors.js';
import {
  ComisionesConfigService,
  esViolacionUnica,
  type ConfiguracionComision,
} from '../src/comisiones/configuraciones.service.js';

const AHORA = new Date().toISOString();

function sembrarProfesionales(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO profesional (id, nombre, matricula, especialidad, activo, created_at, updated_at)
     VALUES ('prof-1', 'Odontologo Ficticio Uno', 'MN-1111', 'Odontologia', 1, ?, ?),
            ('prof-2', 'Odontologo Ficticio Dos', 'MN-2222', 'Odontologia', 0, ?, ?)`,
  ).run(AHORA, AHORA, AHORA, AHORA);
  db.prepare(
    `INSERT INTO prestacion (id, codigo, nombre, duracion_min, created_at, updated_at)
     VALUES ('pres-1', 'CONS-01', 'Consulta Ficticia', 30, ?, ?),
            ('pres-2', 'RES-02', 'Restauracion Ficticia', 60, ?, ?)`,
  ).run(AHORA, AHORA, AHORA, AHORA);
}

function contarVigentes(db: DatabaseSync, tabla: string): number {
  const fila = db
    .prepare(`SELECT COUNT(*) AS n FROM ${tabla} WHERE deleted_at IS NULL`)
    .get() as { n: number };
  return fila.n;
}

/** Captura el ComisionError (falla si la operación NO lanza). */
function capturarComision(fn: () => unknown): ComisionError {
  try {
    fn();
  } catch (err: unknown) {
    if (err instanceof ComisionError) return err;
    throw err;
  }
  throw new Error('la operación debía lanzar un ComisionError');
}

describe('comisiones/configuraciones.service (C-13, task 5.1)', () => {
  let db: DatabaseSync;
  let servicio: ComisionesConfigService;

  beforeEach(() => {
    db = openDatabase(':memory:');
    sembrarProfesionales(db);
    servicio = new ComisionesConfigService(db);
  });

  afterEach(() => {
    db.close();
  });

  it('Dado profesional activo sin configuración Cuando guardo {pct 40, [pres-1→30]} Entonces persiste y obtenerConfiguracion refleja config + tratamientos', () => {
    const resultado = servicio.guardarConfiguracion({
      profesional_id: 'prof-1',
      pct_general: 40,
      tratamientos: [{ prestacion_id: 'pres-1', pct: 30 }],
    });
    expect(resultado.config).not.toBeNull();
    expect(resultado.config!.pct_general).toBe(40);
    expect(resultado.tratamientos.map((t) => t.prestacion_id)).toEqual(['pres-1']);
    expect(resultado.tratamientos[0]!.pct).toBe(30);
    const releida = servicio.obtenerConfiguracion('prof-1');
    expect(releida.config!.pct_general).toBe(40);
    expect(contarVigentes(db, 'profesional_comision')).toBe(1);
    expect(contarVigentes(db, 'profesional_comision_tratamiento')).toBe(1);
  });

  it('Dado configuración vigente {40, [pres-1→30]} Cuando vuelvo a guardar {45, [pres-1→31]} Entonces upsert idempotente: sigue UNA única fila vigente y los valores quedan 45/31', () => {
    servicio.guardarConfiguracion({
      profesional_id: 'prof-1',
      pct_general: 40,
      tratamientos: [{ prestacion_id: 'pres-1', pct: 30 }],
    });
    const repetido = servicio.guardarConfiguracion({
      profesional_id: 'prof-1',
      pct_general: 45,
      tratamientos: [{ prestacion_id: 'pres-1', pct: 31 }],
    });
    expect(repetido.config!.pct_general).toBe(45);
    expect(repetido.tratamientos[0]!.pct).toBe(31);
    expect(contarVigentes(db, 'profesional_comision')).toBe(1);
    expect(contarVigentes(db, 'profesional_comision_tratamiento')).toBe(1);
  });

  it('Dado tratamientos vigentes [pres-1] Cuando guardo tratamientos [pres-2] Entonces reemplazo completo: pres-1 queda de baja y solo pres-2 es vigente', () => {
    servicio.guardarConfiguracion({
      profesional_id: 'prof-1',
      pct_general: 40,
      tratamientos: [{ prestacion_id: 'pres-1', pct: 30 }],
    });
    const reemplazo = servicio.guardarConfiguracion({
      profesional_id: 'prof-1',
      pct_general: 40,
      tratamientos: [{ prestacion_id: 'pres-2', pct: 25 }],
    });
    expect(reemplazo.tratamientos.map((t) => t.prestacion_id)).toEqual(['pres-2']);
    // Fila de pres-1 sigue existiendo (soft delete) pero NO vigente.
    expect(contarVigentes(db, 'profesional_comision_tratamiento')).toBe(1);
    const totalFilas = db
      .prepare('SELECT COUNT(*) AS n FROM profesional_comision_tratamiento')
      .get() as { n: number };
    expect(totalFilas.n).toBe(2);
  });

  it('Dado pct 140 / −5 / 1.5 Cuando guardo Entonces 422 validacion por cada uno y el estado previo queda intacto', () => {
    const antes = servicio.guardarConfiguracion({
      profesional_id: 'prof-1',
      pct_general: 40,
      tratamientos: [],
    });
    for (const pctInvalido of [140, -5, 1.5]) {
      const error = capturarComision(() =>
        servicio.guardarConfiguracion({
          profesional_id: 'prof-1',
          pct_general: pctInvalido,
          tratamientos: [],
        }),
      );
      expect(error.status).toBe(422);
      expect(error.code).toBe('validacion');
    }
    const despues = servicio.obtenerConfiguracion('prof-1');
    expect(despues.config!.id).toBe(antes.config!.id);
    expect(despues.config!.pct_general).toBe(40);
  });

  it('Dado body con prestacion_id duplicado Cuando guardo Entonces 422 validacion con detalle y nada persiste', () => {
    const error = capturarComision(() =>
      servicio.guardarConfiguracion({
        profesional_id: 'prof-1',
        pct_general: 40,
        tratamientos: [
          { prestacion_id: 'pres-1', pct: 30 },
          { prestacion_id: 'pres-1', pct: 25 },
        ],
      }),
    );
    expect(error.status).toBe(422);
    expect(error.code).toBe('validacion');
    expect(error.detalle).toMatch(/duplicado/);
    expect(contarVigentes(db, 'profesional_comision')).toBe(0);
    expect(contarVigentes(db, 'profesional_comision_tratamiento')).toBe(0);
  });

  it('Dado profesional inexistente o inactivo Cuando guardo Entonces 404 not_found y nada persiste (R4)', () => {
    for (const profesionalId of ['prof-inexistente', 'prof-2']) {
      const error = capturarComision(() =>
        servicio.guardarConfiguracion({
          profesional_id: profesionalId,
          pct_general: 40,
          tratamientos: [],
        }),
      );
      expect(error.status).toBe(404);
      expect(error.code).toBe('not_found');
    }
    expect(contarVigentes(db, 'profesional_comision')).toBe(0);
  });

  it('Dado body con prestacion_id inexistente Cuando guardo Entonces 422 validacion (patrón exigirFk de C-04)', () => {
    const error = capturarComision(() =>
      servicio.guardarConfiguracion({
        profesional_id: 'prof-1',
        pct_general: 40,
        tratamientos: [{ prestacion_id: 'pres-inexistente', pct: 30 }],
      }),
    );
    expect(error.status).toBe(422);
    expect(error.code).toBe('validacion');
    expect(contarVigentes(db, 'profesional_comision_tratamiento')).toBe(0);
  });

  it('Dado un error crudo de UNIQUE sintético Cuando esViolacionUnica evalúa Entonces true / con FK o error común false (mapeo identidad_ya_configurada por cinturón, límite documentado)', () => {
    expect(
      esViolacionUnica(
        new Error('UNIQUE constraint failed: profesional_comision.profesional_id'),
      ),
    ).toBe(true);
    expect(esViolacionUnica(new Error('FOREIGN KEY constraint failed'))).toBe(false);
    expect(esViolacionUnica(new Error('database is locked'))).toBe(false);
    expect(esViolacionUnica('no es un error')).toBe(false);
  });

  it('Dado profesional sin configuración ni tratamientos Cuando obtengo Entonces {config: null, tratamientos: []} (lectura tolerante)', () => {
    const estado: ConfiguracionComision = servicio.obtenerConfiguracion('prof-1');
    expect(estado.config).toBeNull();
    expect(estado.tratamientos).toEqual([]);
  });
});
