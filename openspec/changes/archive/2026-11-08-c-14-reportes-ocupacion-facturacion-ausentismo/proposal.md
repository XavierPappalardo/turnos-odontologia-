# Proposal — C-14 reportes-ocupacion-facturacion-ausentismo

## Why

La KB define F-11 (reportes de ocupación, facturación y ausentismo) como imprescindible del MVP y `03-actores.md` asigna al dueño "acceso total a reportes". Hoy el sistema ya persiste todo lo necesario —`turno` con `inicio`/`fin`/`estado`, `movimiento_caja` append-only con `aplicado_en`, y `pago` con `medio`— pero **no existe ninguna lectura agregada**: el dueño no puede responder cuántas horas se ocuparon, cuánta plata entró ni qué porcentaje de pacientes faltó. Sin C-14, el tablero de FL-05 ("el resultado alimenta el tablero del dueño") queda sin fuente y el camino crítico del MVP no se cierra.

## What Changes

- Nuevo módulo de reportes **estrictamente de lectura** con tres endpoints JSON bajo `/api/reportes`: `ocupacion`, `facturacion`, `ausentismo`.
- **Ocupación = minutos ocupados absolutos** derivados de `turno.inicio`/`turno.fin`. Sin denominador, sin capacidad teórica, sin grilla de slots y sin variables de entorno de horario de atención.
- **Facturación = percibida**, calculada sobre `movimiento_caja` y agrupada por `aplicado_en`. Extiende multi-día la semántica que ya usa `GET /caja/resumen`, con neteo de anulaciones y desglose por medio.
- **Ausentismo = solo `turno.estado = 'ausente'`** sobre el subconjunto de turnos resueltos (`atendido` + `ausente`). No se implementa la "cancelación tardía" de `07-flujos.md:19`.
- Agrupación por `dia`, `semana` (ISO-8601, lunes primero) y `mes`, en la zona `CAJA_ZONA_HORARIA` (default `America/Buenos_Aires`).
- RBAC: `administracion` ve todo; `recepcion` ve ocupación y ausentismo; `profesional` ve solo sus propias métricas de ocupación y ausentismo; facturación queda cerrada a `administracion`.
- **Sin migración**: no se agregan tablas, columnas, estados ni índices. El esquema actual alcanza.
- **Sin UI**: no se toca `frontend/`, no se agregan librerías de gráficos ni se dispara el gate de `design-system`.

## Capabilities

### New Capabilities

- `reportes/ocupacion`: minutos ocupados absolutos por período, granularidad y dimensión (profesional, sillón), con bucketing en zona horaria local y RBAC por rol.
- `reportes/facturacion`: ingresos netos percibidos por `movimiento_caja.aplicado_en`, desglose por medio de pago y separación bolsillo/obra social, solo para `administracion`.
- `reportes/ausentismo`: cantidad de ausentes sobre turnos resueltos y tasa entera derivada, por período, granularidad y profesional.

### Modified Capabilities

Ninguna. C-14 solo agrega lecturas nuevas; no altera requisitos existentes de `agenda`, `caja` ni `obras-sociales`.

## Impact

- Nuevos: `backend/src/reportes/reportes.repository.ts`, `backend/src/reportes/periodo.ts`, `backend/src/reportes/ocupacion.service.ts`, `backend/src/reportes/facturacion.service.ts`, `backend/src/reportes/ausentismo.service.ts`, `backend/src/reportes/reportes.routes.ts`.
- `backend/src/shared/app.ts` — montaje de `reportesRouter` en `/api`.
- `backend/src/shared/auth.ts` — permisos de lectura de reportes por rol.
- `backend/src/shared/errors.ts` — error tipado `ReportesError` (`400` validación, `403` forbidden).
- Tests nuevos: `backend/tests/reportes_ocupacion.test.ts`, `backend/tests/reportes_facturacion.test.ts`, `backend/tests/reportes_ausentismo.test.ts`, `backend/tests/reportes_periodo.test.ts`, `backend/tests/reportes_routes.test.ts`.
- Sin migración, sin dependencias nuevas, sin cambios en `frontend/`, sin cambios en la máquina de estados del turno ni en la lógica de caja.

## Non-Goals

- **Facturación devengada**: imposible mientras `prestacion` no tenga precio y C-15 (`precios-publicos-ars`) siga pendiente. Descartada explícitamente.
- **Rentabilidad por tratamiento/profesional**: depende de comisiones (C-13, aún `[ ]`). Fuera de alcance.
- **Cancelación tardía como insumo de ausentismo**: descartada para evitar migración y campos nuevos; requiere `cancelado_en` o un estado adicional que este change no introduce.
- **Dashboards, gráficos, exportación CSV y cualquier cambio de UI**.
- **Tablas materializadas o snapshots de métricas**: se agrega on-the-fly sobre el esquema existente.
- **Capacidad teórica / horarios de atención**: no existen en el modelo y no se inventan.

## Nota de gobernanza

Governance **LOW** (read-only, sin escrituras ni migraciones), alineado con `AGENTS.md` R16. `CHANGES.md` se actualiza en un paso separado para reflejar esta decisión y eliminar la referencia rota a `08-arquitectura.md §Reportes` (esa sección no existe).
