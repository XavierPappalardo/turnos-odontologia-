/**
 * Servicio de Catálogo y Tarifas de Prestaciones (C-15; F-12 / RN-12).
 * Expone prestaciones activas con su formateo de moneda ARS y gestiona actualizaciones de precios.
 */
import type { DatabaseSync } from 'node:sqlite';
import { AppError } from '../shared/errors.js';
import { formatearMonedaArs } from './formatoMoneda.js';
import { PrestacionRepository } from './prestacion.repository.js';

export interface PrestacionPublicaDto {
  id: string;
  codigo: string;
  nombre: string;
  duracion_min: number;
  precio_base_centavos: number;
  precio_formateado: string;
}

export class CatalogoService {
  private readonly repo: PrestacionRepository;

  constructor(db: DatabaseSync) {
    this.repo = new PrestacionRepository(db);
  }

  listarPrestacionesPublicas(): PrestacionPublicaDto[] {
    const activas = this.repo.listarActivas();
    return activas.map((p) => ({
      id: p.id,
      codigo: p.codigo,
      nombre: p.nombre,
      duracion_min: p.duracion_min,
      precio_base_centavos: p.precio_base_centavos ?? 0,
      precio_formateado: formatearMonedaArs(p.precio_base_centavos ?? 0),
    }));
  }

  listarPrestacionesInternas(): PrestacionPublicaDto[] {
    const activas = this.repo.listarActivas();
    return activas.map((p) => ({
      id: p.id,
      codigo: p.codigo,
      nombre: p.nombre,
      duracion_min: p.duracion_min,
      precio_base_centavos: p.precio_base_centavos ?? 0,
      precio_formateado: formatearMonedaArs(p.precio_base_centavos ?? 0),
    }));
  }

  actualizarPrecio(
    id: string,
    precioBaseCentavos: number,
  ): PrestacionPublicaDto {
    const actualizada = this.repo.actualizarPrecio(id, precioBaseCentavos);
    if (!actualizada) {
      throw new AppError({
        status: 404,
        code: 'not_found',
        message: 'Prestación no encontrada',
      });
    }

    return {
      id: actualizada.id,
      codigo: actualizada.codigo,
      nombre: actualizada.nombre,
      duracion_min: actualizada.duracion_min,
      precio_base_centavos: actualizada.precio_base_centavos ?? 0,
      precio_formateado: formatearMonedaArs(actualizada.precio_base_centavos ?? 0),
    };
  }
}
