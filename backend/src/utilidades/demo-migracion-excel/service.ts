import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../shared/errors.js';
import { BaseRepository, UnitOfWork } from '../../shared/repository.js';
import { seedMinimo } from '../../shared/seed.js';
import { normalizarIsoUtc } from '../../shared/fechas.js';
import { TurnoRepository } from '../../agenda/turno.repository.js';
import { BloqueoRepository } from '../../agenda/bloqueo.repository.js';
import type { ProfesionalId, SillonId, TurnoId, PacienteId, PrestacionId, TurnoEstado, TurnoOrigen } from '../../shared/types.js';
import { aplicarMapeo, parsearContenido } from './parser.js';
import {
  ENTIDADES,
  FORMATOS,
  type EntidadImportacion,
  type ErrorFila,
  type PayloadImportacion,
  type ResultadoConfirmacion,
  type ResultadoPreview,
} from './tipos.js';

const ESTADOS_TURNO = new Set(['reservado', 'confirmado', 'presente', 'atendido', 'cancelado', 'ausente']);
const ESTADOS_ACTIVOS = new Set(['reservado', 'confirmado', 'presente']);
const ORIGENES_TURNO = new Set(['recepcion', 'online', 'whatsapp']);

function assertPayload(p: unknown): asserts p is PayloadImportacion {
  if (!p || typeof p !== 'object') throw new AppError({ status: 400, code: 'validacion', message: 'payload invÃ¡lido' });
  const o = p as Record<string, unknown>;
  if (!ENTIDADES.includes(o.entidad as EntidadImportacion)) throw new AppError({ status: 400, code: 'validacion', message: 'entidad no soportada' });
  if (!FORMATOS.includes(o.formato as any)) throw new AppError({ status: 400, code: 'formato_no_soportado', message: 'formato no soportado' });
  if (typeof o.contenido !== 'string') throw new AppError({ status: 400, code: 'validacion', message: 'contenido requerido' });
}

function err(fila: number, codigo: ErrorFila['codigo'], mensaje: string, campo?: string): ErrorFila {
  return campo ? { fila, codigo, mensaje, campo } : { fila, codigo, mensaje };
}

function existeId(db: DatabaseSync, tabla: string, id: string): boolean {
  return db.prepare(`SELECT 1 FROM ${tabla} WHERE id = ? LIMIT 1`).get(id) !== undefined;
}
function existeFkActiva(db: DatabaseSync, tabla: 'profesional' | 'sillon', id: string): boolean {
  return db.prepare(`SELECT 1 FROM ${tabla} WHERE id = ? AND activo = 1 LIMIT 1`).get(id) !== undefined;
}
function existePrestacion(db: DatabaseSync, id: string): boolean {
  return db.prepare(`SELECT 1 FROM prestacion WHERE id = ? LIMIT 1`).get(id) !== undefined;
}

type Intervalo = { inicio: string; fin: string; profesionalId: string; sillonId: string };
function solapa(a: { inicio: string; fin: string }, b: { inicio: string; fin: string }): boolean {
  return a.inicio < b.fin && a.fin > b.inicio;
}

export class DemoMigracionService {
  constructor(private readonly db: DatabaseSync) {}

  cargarDemo(): { ok: true; mensaje: string } {
    seedMinimo(this.db);
    return { ok: true, mensaje: 'demo ficticia cargada' };
  }

  async preview(payload: unknown): Promise<ResultadoPreview> {
    assertPayload(payload);
    const { filas, errores: erroresParse } = await parsearContenido(payload.formato, payload.contenido);
    const mapeadas = aplicarMapeo(filas, payload.mapeo);
    const { errores, filasValidas } = this.validar(payload.entidad, mapeadas, false);
    const todosErrores = [...erroresParse, ...errores];
    const filasInvalidasSet = new Set(todosErrores.map((e) => e.fila));
    const validas = Math.max(0, filasValidas - [...filasInvalidasSet].filter((f) => f <= mapeadas.length).length);
    // recalcular con precisiÃ³n: una fila con error no es vÃ¡lida
    const filasConError = new Set(todosErrores.map((e) => e.fila));
    const countValidas = mapeadas.filter((f) => !filasConError.has(f.fila)).length;
    return {
      entidad: payload.entidad,
      formato: payload.formato,
      totalFilas: mapeadas.length,
      filasValidas: countValidas,
      filasInvalidas: mapeadas.length - countValidas,
      errores: todosErrores,
      muestrasSeguras: mapeadas.slice(0, 3).map((f) => ({ fila: f.fila, campos: Object.keys(f.datos).sort() })),
      persistido: false,
    };
  }

  async confirmar(payload: unknown): Promise<ResultadoConfirmacion> {
    assertPayload(payload);
    const { filas } = await parsearContenido(payload.formato, payload.contenido);
    const mapeadas = aplicarMapeo(filas, payload.mapeo);
    // Revalidar en confirmar (no confiar en preview).
    const { filasAceptadas, errores } = this.validar(payload.entidad, mapeadas, true);
    let insertadas = 0;
    const erroresPersist: ErrorFila[] = [...errores];
    if (filasAceptadas.length > 0) {
      const uow = new UnitOfWork(this.db);
      try {
        uow.runInTransaction(() => {
          for (const f of filasAceptadas) {
            this.insertar(payload.entidad, f.datos);
            insertadas++;
          }
        });
      } catch {
        // Error inesperado: rollback implícito en UoW, sin estado parcial, sin loguear PHI.
        return {
          entidad: payload.entidad,
          formato: payload.formato,
          totalFilas: mapeadas.length,
          insertadas: 0,
          rechazadas: mapeadas.length - [...new Set(errores.map((e) => e.fila))].length,
          errores: [...errores, err(0, 'regla_negocio', 'fallo seguro al confirmar importación; sin cambios persistidos')],
        };
      }
    }
    const filasRechazadasSet = new Set(erroresPersist.map((e) => e.fila));
    return {
      entidad: payload.entidad,
      formato: payload.formato,
      totalFilas: mapeadas.length,
      insertadas,
      rechazadas: mapeadas.filter((f) => filasRechazadasSet.has(f.fila)).length + (filasAceptadas.length - insertadas),
      errores: erroresPersist,
    };
  }

  private validar(
    entidad: EntidadImportacion,
    filas: Array<{ fila: number; datos: Record<string, string> }>,
    _paraConfirmar: boolean,
  ): { errores: ErrorFila[]; filasValidas: number; filasAceptadas: Array<{ fila: number; datos: Record<string, string> }> } {
    const errores: ErrorFila[] = [];
    const aceptadas: Array<{ fila: number; datos: Record<string, string> }> = [];
    const idsVistos = new Set<string>();
    const intervalosAceptados: Intervalo[] = [];

    for (const f of filas) {
      const errsAntes = errores.length;
      if (entidad === 'profesionales') this.validarProfesional(f.fila, f.datos, idsVistos, errores);
      else if (entidad === 'pacientes') this.validarPaciente(f.fila, f.datos, idsVistos, errores);
      else if (entidad === 'turnos') this.validarTurno(f.fila, f.datos, idsVistos, intervalosAceptados, errores);
      if (errores.length === errsAntes) {
        aceptadas.push(f);
        const iv = (f.datos as any).__intervalo as Intervalo | undefined;
        if (iv && (f.datos as any).__activo) intervalosAceptados.push(iv);
      }
    }
    return { errores, filasValidas: aceptadas.length, filasAceptadas: aceptadas };
  }

  private validarProfesional(fila: number, d: Record<string, string>, ids: Set<string>, errores: ErrorFila[]): void {
    const id = (d.id || randomUUID()).trim();
    const nombre = (d.nombre || '').trim();
    if (!nombre) errores.push(err(fila, 'campo_requerido', 'nombre requerido', 'nombre'));
    if (id && ids.has(id)) errores.push(err(fila, 'duplicado', 'id duplicado en archivo', 'id'));
    if (id && this.db && existeId(this.db, 'profesional', id)) errores.push(err(fila, 'duplicado', 'id ya existe', 'id'));
    ids.add(id);
    d.id = id;
  }

  private validarPaciente(fila: number, d: Record<string, string>, ids: Set<string>, errores: ErrorFila[]): void {
    const id = (d.id || randomUUID()).trim();
    const nombre = (d.nombre || '').trim();
    if (!nombre) errores.push(err(fila, 'campo_requerido', 'nombre requerido', 'nombre'));
    if (id && ids.has(id)) errores.push(err(fila, 'duplicado', 'id duplicado en archivo', 'id'));
    if (id && existeId(this.db, 'paciente', id)) errores.push(err(fila, 'duplicado', 'id ya existe', 'id'));
    ids.add(id);
    d.id = id;
  }

  private validarTurno(
    fila: number,
    d: Record<string, string>,
    ids: Set<string>,
    intervalosAceptados: Intervalo[],
    errores: ErrorFila[],
  ): void {
    const id = (d.id || randomUUID()).trim();
    const profesionalId = (d.profesional_id || d.profesionalId || '').trim();
    const sillonId = (d.sillon_id || d.sillonId || '').trim();
    const pacienteId = (d.paciente_id || d.pacienteId || '').trim();
    const prestacionId = (d.prestacion_id || d.prestacionId || '').trim() || undefined;
    const inicioRaw = (d.inicio || '').trim();
    const finRaw = (d.fin || '').trim();
    const estadoRaw = (d.estado || 'atendido').trim();
    const origenRaw = (d.origen || 'recepcion').trim();

    if (!profesionalId) errores.push(err(fila, 'campo_requerido', 'profesional_id requerido', 'profesional_id'));
    if (!sillonId) errores.push(err(fila, 'campo_requerido', 'sillon_id requerido', 'sillon_id'));
    if (!pacienteId) errores.push(err(fila, 'campo_requerido', 'paciente_id requerido', 'paciente_id'));
    if (!inicioRaw) errores.push(err(fila, 'campo_requerido', 'inicio requerido', 'inicio'));
    if (!finRaw) errores.push(err(fila, 'campo_requerido', 'fin requerido', 'fin'));
    if (!ESTADOS_TURNO.has(estadoRaw)) errores.push(err(fila, 'formato_invalido', 'estado invÃ¡lido', 'estado'));
    if (!ORIGENES_TURNO.has(origenRaw)) errores.push(err(fila, 'formato_invalido', 'origen invÃ¡lido', 'origen'));
    if (id && ids.has(id)) errores.push(err(fila, 'duplicado', 'id duplicado en archivo', 'id'));
    if (id && existeId(this.db, 'turno', id)) errores.push(err(fila, 'duplicado', 'id ya existe', 'id'));

    const inicio = inicioRaw ? normalizarIsoUtc(inicioRaw) : undefined;
    const fin = finRaw ? normalizarIsoUtc(finRaw) : undefined;
    if (inicioRaw && !inicio) errores.push(err(fila, 'formato_invalido', 'inicio invÃ¡lido (ISO UTC esperado)', 'inicio'));
    if (finRaw && !fin) errores.push(err(fila, 'formato_invalido', 'fin invÃ¡lido (ISO UTC esperado)', 'fin'));
    if (inicio && fin && fin <= inicio) errores.push(err(fila, 'regla_negocio', 'fin debe ser posterior a inicio', 'fin'));

    if (profesionalId && !existeId(this.db, 'profesional', profesionalId))
      errores.push(err(fila, 'referencia_inexistente', 'profesional_id inexistente', 'profesional_id'));
    if (sillonId && !existeId(this.db, 'sillon', sillonId))
      errores.push(err(fila, 'referencia_inexistente', 'sillon_id inexistente', 'sillon_id'));
    if (pacienteId && !existeId(this.db, 'paciente', pacienteId))
      errores.push(err(fila, 'referencia_inexistente', 'paciente_id inexistente', 'paciente_id'));
    if (prestacionId && !existePrestacion(this.db, prestacionId))
      errores.push(err(fila, 'referencia_inexistente', 'prestacion_id inexistente', 'prestacion_id'));

    if (ESTADOS_ACTIVOS.has(estadoRaw) && inicio && fin && profesionalId && sillonId) {
      if (profesionalId && existeId(this.db, 'profesional', profesionalId) && !existeFkActiva(this.db, 'profesional', profesionalId))
        errores.push(err(fila, 'regla_negocio', 'profesional inactivo para turno activo', 'profesional_id'));
      if (sillonId && existeId(this.db, 'sillon', sillonId) && !existeFkActiva(this.db, 'sillon', sillonId))
        errores.push(err(fila, 'regla_negocio', 'sillÃ³n inactivo para turno activo', 'sillon_id'));
      const turnos = new TurnoRepository(this.db);
      if (turnos.existeSolapeProfesional(profesionalId as ProfesionalId, inicio, fin))
        errores.push(err(fila, 'solapamiento', 'solape por profesional', 'profesional_id'));
      if (turnos.existeSolapeSillon(sillonId as SillonId, inicio, fin))
        errores.push(err(fila, 'solapamiento', 'solape por sillÃ³n', 'sillon_id'));
      const bloqueos = new BloqueoRepository(this.db);
      if (bloqueos.existeBloqueoAplicable(profesionalId as ProfesionalId, sillonId as SillonId, inicio, fin))
        errores.push(err(fila, 'solapamiento', 'bloqueo aplicable', 'inicio'));
      const intervalo = { inicio, fin, profesionalId, sillonId };
      const solapaLote = intervalosAceptados.some(
        (b) =>
          solapa(intervalo, b) &&
          (intervalo.profesionalId === b.profesionalId || intervalo.sillonId === b.sillonId),
      );
      if (solapaLote) errores.push(err(fila, 'solapamiento', 'solape dentro del lote importado'));
    }

    ids.add(id);
    d.id = id;
    d.profesional_id = profesionalId;
    d.sillon_id = sillonId;
    d.paciente_id = pacienteId;
    if (prestacionId) d.prestacion_id = prestacionId;
    if (inicio) d.inicio = inicio;
    if (fin) d.fin = fin;
    d.estado = estadoRaw;
    d.origen = origenRaw;
    (d as any).__intervalo = inicio && fin ? ({ inicio, fin, profesionalId, sillonId } as Intervalo) : undefined;
    (d as any).__activo = ESTADOS_ACTIVOS.has(estadoRaw);
  }

  private insertar(entidad: EntidadImportacion, d: Record<string, string>): void {
    const now = new Date().toISOString();
    if (entidad === 'profesionales') {
      new BaseRepository(this.db, 'profesional').insert({
        id: d.id!,
        nombre: d.nombre!,
        matricula: d.matricula?.trim() || null,
        especialidad: d.especialidad?.trim() || null,
        activo: (d.activo ?? '1') === '0' ? 0 : 1,
        deleted_at: null,
      } as any);
      return;
    }
    if (entidad === 'pacientes') {
      new BaseRepository(this.db, 'paciente').insert({
        id: d.id!,
        nombre: d.nombre!,
        telefono_whatsapp: d.telefono_whatsapp?.trim() || d.telefono?.trim() || null,
        obra_social_plan_id: d.obra_social_plan_id?.trim() || null,
        activo: (d.activo ?? '1') === '0' ? 0 : 1,
        fecha_nacimiento: d.fecha_nacimiento?.trim() || null,
        alergias: d.alergias?.trim() || null,
        deleted_at: null,
      } as any);
      return;
    }
    if (entidad === 'turnos') {
      new TurnoRepository(this.db).crear({
        id: d.id! as TurnoId,
        profesionalId: d.profesional_id! as ProfesionalId,
        sillonId: d.sillon_id! as SillonId,
        pacienteId: d.paciente_id! as PacienteId,
        prestacionId: d.prestacion_id as PrestacionId | undefined,
        inicio: d.inicio!,
        fin: d.fin!,
        estado: (d.estado || 'atendido') as TurnoEstado,
        origen: (d.origen || 'recepcion') as TurnoOrigen,
      });
      // Si el estado importado difiere del default de creaciÃ³n, ajustar.
      if (d.estado && d.estado !== 'reservado') {
        this.db.prepare(`UPDATE turno SET estado = ?, updated_at = ? WHERE id = ?`).run(d.estado, now, d.id);
      }
      if (d.origen && d.origen !== 'recepcion') {
        this.db.prepare(`UPDATE turno SET origen = ?, updated_at = ? WHERE id = ?`).run(d.origen, now, d.id);
      }
      return;
    }
    throw new AppError({ status: 400, code: 'validacion', message: 'entidad no soportada' });
  }
}

