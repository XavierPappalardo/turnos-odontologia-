/**
 * C-14 task 8.2/8.4 — `reportes.routes.ts`: rutas HTTP read-only de reportes.
 *
 * Montadas bajo `/api` (`GET /api/reportes/{ocupacion,facturacion,ausentismo}`).
 * La ruta sólo hace auth/RBAC, parseo de query y mapeo del contrato; toda la
 * lógica de dominio vive en los servicios y todo el SQL en el repositorio
 * (design D8, R8).
 *
 * RBAC (design D10):
 * - `administracion` y `recepcion` ven ocupación y ausentismo globales.
 * - `profesional` los ve con su propio `profesional_id` forzado; si pide otro o
 *   no tiene vínculo, `403`.
 * - facturación es exclusiva de `administracion` (R4).
 *
 * Errores: `ReportesError` (400 `validacion` con `detalle` = campo inválido;
 * 403 `forbidden` sin detalle). Sin PHI en cuerpos ni logs (R3).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { getAuth, requireAuth } from '../auth/middleware.js';
import type { AppConfig } from '../shared/config.js';
import { ReportesError } from '../shared/errors.js';
import {
  puedeVerReporteFacturacion,
  puedeVerReportesOperativos,
} from '../shared/auth.js';
import { crearServicioAusentismo } from './ausentismo.service.js';
import {
  crearServicioFacturacion,
  esMedioPago,
} from './facturacion.service.js';
import { crearServicioOcupacion } from './ocupacion.service.js';
import { ErrorPeriodoInvalido, type Granularidad } from './periodo.js';
import { ReportesRepository } from './reportes.repository.js';

type Manejador = (req: Request, res: Response, next: NextFunction) => void;

/** Envuelve el handler traduciendo errores al middleware central (patrón caja). */
function manejar(fn: (req: Request, res: Response) => void): Manejador {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      fn(req, res);
    } catch (err) {
      next(traducirErrorReportes(err));
    }
  };
}

/**
 * Identificador opaco admitido en query (`profesional_id`, `sillon_id`).
 * El esquema declara los ids como `TEXT` opacos (no UUID): se exige forma
 * segura (1..64, sin espacios ni comillas) y se rechaza el resto con 400.
 */
const ID_OPACO = /^[A-Za-z0-9_-]{1,64}$/;

interface ReportesQuery {
  readonly desde: string;
  readonly hasta: string;
  readonly granularidad: string | undefined;
  readonly profesionalId: string | undefined;
  readonly sillonId: string | undefined;
  readonly medio: string | undefined;
}

/** Un parámetro repetido o no textual se ignora (los desconocidos no se leen). */
function textoDeQuery(valor: unknown): string | undefined {
  return typeof valor === 'string' ? valor : undefined;
}

function validarIdOpaco(valor: string | undefined, campo: string): void {
  if (valor !== undefined && !ID_OPACO.test(valor)) {
    throw new ReportesError({
      status: 400,
      code: 'validacion',
      message: `${campo} debe ser un identificador opaco válido`,
      detalle: campo,
    });
  }
}

/** Parseo y validación de forma de la query (task 8.4). */
function parsearQuery(req: Request): ReportesQuery {
  const desde = textoDeQuery(req.query['desde']) ?? '';
  const hasta = textoDeQuery(req.query['hasta']) ?? '';
  const profesionalId = textoDeQuery(req.query['profesional_id']);
  const sillonId = textoDeQuery(req.query['sillon_id']);
  validarIdOpaco(profesionalId, 'profesional_id');
  validarIdOpaco(sillonId, 'sillon_id');
  return {
    desde,
    hasta,
    granularidad: textoDeQuery(req.query['granularidad']),
    profesionalId,
    sillonId,
    medio: textoDeQuery(req.query['medio']),
  };
}

function forbidden(mensaje: string): ReportesError {
  return new ReportesError({
    status: 403,
    code: 'forbidden',
    message: mensaje,
  });
}

/**
 * Alcance de los reportes operativos (design D10). Devuelve el
 * `profesionalId` efectivo a aplicar: el de la query para roles operativos, el
 * propio (forzado) para un profesional.
 */
function alcanceOperativo(
  res: Response,
  profesionalIdQuery: string | undefined,
): string | undefined {
  const auth = getAuth(res);
  if (auth.roles.some((rol) => puedeVerReportesOperativos(rol))) {
    return profesionalIdQuery;
  }
  if (!auth.roles.includes('profesional')) {
    throw forbidden('rol no autorizado para reportes operativos');
  }
  const propio = auth.profesionalId;
  if (propio === undefined) {
    throw forbidden('usuario profesional sin vínculo');
  }
  if (profesionalIdQuery !== undefined && profesionalIdQuery !== propio) {
    throw forbidden('un profesional sólo puede consultar sus propias métricas');
  }
  return propio;
}

export function reportesRouter(db: DatabaseSync, config: AppConfig): Router {
  const router = Router();
  const autenticado = requireAuth(config.jwtSecret, db);
  const repo = new ReportesRepository(db);
  const zonaHoraria = config.caja.zonaHoraria;
  const ocupacion = crearServicioOcupacion({ repo, zonaHoraria });
  const ausentismo = crearServicioAusentismo({ repo, zonaHoraria });
  const facturacion = crearServicioFacturacion({ repo, zonaHoraria });

  // GET /reportes/ocupacion — minutos ocupados absolutos (sin denominador).
  router.get(
    '/reportes/ocupacion',
    autenticado,
    manejar((req, res) => {
      const query = parsearQuery(req);
      const profesionalId = alcanceOperativo(res, query.profesionalId);
      const reporte = ocupacion.calcular({
        desde: query.desde,
        hasta: query.hasta,
        granularidad: query.granularidad as Granularidad | undefined,
        profesionalId,
        sillonId: query.sillonId,
      });
      res.status(200).json(reporte);
    }),
  );

  // GET /reportes/ausentismo — ausentes sobre turnos resueltos, tasa entera.
  router.get(
    '/reportes/ausentismo',
    autenticado,
    manejar((req, res) => {
      const query = parsearQuery(req);
      const profesionalId = alcanceOperativo(res, query.profesionalId);
      const reporte = ausentismo.calcular({
        desde: query.desde,
        hasta: query.hasta,
        granularidad: query.granularidad as Granularidad | undefined,
        profesionalId,
      });
      res.status(200).json(reporte);
    }),
  );

  // GET /reportes/facturacion — percibida por aplicado_en; sólo administración.
  router.get(
    '/reportes/facturacion',
    autenticado,
    manejar((req, res) => {
      const auth = getAuth(res);
      if (!auth.roles.some((rol) => puedeVerReporteFacturacion(rol))) {
        throw forbidden('facturación es exclusiva de administración');
      }
      const query = parsearQuery(req);
      if (query.medio !== undefined && !esMedioPago(query.medio)) {
        throw new ReportesError({
          status: 400,
          code: 'validacion',
          message: 'medio fuera del catálogo',
          detalle: 'medio',
        });
      }
      const reporte = facturacion.calcular({
        desde: query.desde,
        hasta: query.hasta,
        granularidad: query.granularidad as Granularidad | undefined,
        medio: query.medio,
      });
      res.status(200).json(reporte);
    }),
  );

  return router;
}

/**
 * Traduce `ErrorPeriodoInvalido` (contrato de `periodo.ts`) a `ReportesError`
 * 400 con el campo como `detalle`, para que el error handler central serialice
 * sin conocer el módulo.
 */
function traducirErrorReportes(err: unknown): unknown {
  if (err instanceof ErrorPeriodoInvalido) {
    return new ReportesError({
      status: 400,
      code: 'validacion',
      message: err.message,
      detalle: err.campo,
    });
  }
  return err;
}
