/**
 * Task 2.2: repositorio de cierres de caja (C-11).
 * SQLite REAL en memoria (R12). Verifica: inserción del snapshot, consultas
 * por fecha, UNIQUE(fecha) a nivel base y orden DESC del historial.
 */
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/shared/repository.js';
import { CierreCajaRepository } from '../src/caja/cierreCaja.repository.js';
import type { CierreCajaId } from '../src/shared/types.js';
import { seedCajaBase } from './helpers/caja-fixtures.js';

function cierreBase(fecha: string, id: string): Parameters<CierreCajaRepository['insertar']>[0] {
  return {
    id: id as CierreCajaId,
    fecha,
    zonaHoraria: 'America/Buenos_Aires',
    totalEfectivoCentavos: 100000,
    totalTarjetaCentavos: 200000,
    totalTransferenciaCentavos: 50000,
    totalMercadopagoCentavos: 70000,
    totalObraSocialCentavos: 30000,
    anulacionesCantidad: 1,
    anulacionesCentavos: 20000,
    actorUsuarioId: 'user-caja',
    cerradoEn: '2026-06-30T23:59:00.000Z',
  };
}

describe('CierreCajaRepository — snapshot diario (C-11)', () => {
  it('Dado una caja cerrada Cuando consulto por fecha Entonces existeCierreFecha es true y buscarPorFecha devuelve el snapshot completo', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const repo = new CierreCajaRepository(db);

    repo.insertar(cierreBase('2026-06-30', 'cierre-30'));

    expect(repo.existeCierreFecha('2026-06-30')).toBe(true);
    expect(repo.existeCierreFecha('2026-07-01')).toBe(false);
    const fila = repo.buscarPorFecha('2026-06-30');
    expect(fila).toMatchObject({
      id: 'cierre-30',
      fecha: '2026-06-30',
      zona_horaria: 'America/Buenos_Aires',
      total_efectivo_centavos: 100000,
      total_tarjeta_centavos: 200000,
      total_transferencia_centavos: 50000,
      total_mercadopago_centavos: 70000,
      total_obra_social_centavos: 30000,
      anulaciones_cantidad: 1,
      anulaciones_centavos: 20000,
      actor_usuario_id: 'user-caja',
    });
    db.close();
  });

  it('Dado un segundo cierre para la misma fecha contable Cuando inserto Entonces la base lo rechaza por UNIQUE(fecha) (máximo una caja cerrada por día)', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const repo = new CierreCajaRepository(db);

    repo.insertar(cierreBase('2026-06-30', 'cierre-30-a'));
    expect(() => repo.insertar(cierreBase('2026-06-30', 'cierre-30-b'))).toThrow(
      /UNIQUE constraint failed/,
    );
    // doble defensa: el check-then-insert también lo detecta
    expect(repo.existeCierreFecha('2026-06-30')).toBe(true);
    db.close();
  });

  it('Dado cierres de varias fechas Cuando pide el historial Entonces lo devuelve del más reciente al más antiguo (fechas no cerradas nunca aparecen)', () => {
    const db = openDatabase(':memory:');
    seedCajaBase(db);
    const repo = new CierreCajaRepository(db);

    repo.insertar(cierreBase('2026-06-28', 'cierre-28'));
    repo.insertar(cierreBase('2026-06-30', 'cierre-30'));

    const fechas = repo.listarCierres().map((c) => c.fecha);
    expect(fechas).toEqual(['2026-06-30', '2026-06-28']);
    db.close();
  });
});
