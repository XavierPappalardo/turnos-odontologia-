# Tasks — C-14 reportes-ocupacion-facturacion-ausentismo

Cada grupo sigue el ciclo TDD RED → GREEN → TRIANGULATE → REFACTOR. Los tests usan SQLite real en memoria (`openDatabase(':memory:')`), fixtures ficticios (R1/R12) y nombres `Dado/Cuando/Entonces` (R11). La verificación transversal es `npm test` (Vitest) y `npm run typecheck` (`tsc --noEmit`) en `backend/`.

Recordatorio de alcance: **read-only**. Ninguna tarea de este change crea migraciones, escribe en base, toca `frontend/` ni agrega dependencias.

## 1. `periodo.ts`: validación y bucketing temporal puro

- [x] 1.1 **(RED)** En `backend/tests/reportes_periodo.test.ts`, escribir escenarios de `esFechaLocalValida`: acepta `2026-11-01`, rechaza `01-11-2026`, rechaza `2026-02-31` y rechaza string vacío. Incluir `validarRango`: acepta `desde <= hasta` de 366 días inclusive, rechaza rango invertido, rechaza 367 días y rechaza `granularidad` fuera de `{dia, semana, mes}`. Verificación: los escenarios fallan (módulo inexistente).
- [x] 1.2 **(GREEN)** Implementar `backend/src/reportes/periodo.ts` con `esFechaLocalValida`, `validarRango(desde, hasta, granularidad)`, `diasEntre(desde, hasta)` y `claveDeGrupo(fechaLocal, granularidad)`. Sin acceso a `db` ni a `config`. Verificación: escenarios de 1.1 verdes.
- [x] 1.3 **(TRIANGULATE)** Agregar `claveSemanaIso` con casos de borde: 2026-12-31 y 2027-01-01 caen en `2026-W53`; 2026-01-01 cae en `2026-W01` (esa semana ISO empieza el 2025-12-29); un lunes y el domingo siguiente comparten clave; un domingo y el lunes siguiente no. Agregar `claveDeGrupo` para `mes` y `dia`. Verificación: escenarios verdes.
- [x] 1.4 **(REFACTOR)** Extraer la aritmética de ISO week a funciones privadas del módulo y confirmar `npm run typecheck` sin `any` (R10).

## 2. `ReportesRepository`: agregados de ocupación y ausentismo

- [x] 2.1 **(RED)** En `backend/tests/reportes_ocupacion.test.ts` y `backend/tests/reportes_ausentismo.test.ts`, escribir escenarios de repositorio sobre SQLite en memoria: `ocupacionEnVentana(desdeUtc, hastaUtc)` devuelve solo columnas mínimas (`profesional_id`, `sillon_id`, `inicio`, `fin`, `estado`); excluye `cancelado`, `ausente` y turnos con `deleted_at`; `conteoResueltosEnVentana` cuenta únicamente `atendido` y `ausente`; el filtro grueso respeta el margen de ±1 día. Verificación: los escenarios fallan (repositorio inexistente).
- [x] 2.2 **(GREEN)** Implementar `backend/src/reportes/reportes.repository.ts` extendiendo `BaseRepository` (o siguiendo el patrón de `cajaMovimiento.repository.ts`), con todo el SQL del módulo (R8) y parámetros vinculados. Verificación: escenarios de 2.1 verdes.
- [x] 2.3 **(TRIANGULATE)** Agregar escenarios de filtro por `profesional_id` y por `sillon_id`, de turno que toca exactamente el borde del rango grueso, y de rango sin filas (devuelve array vacío, no `undefined`). Verificación: escenarios verdes.
- [x] 2.4 **(REFACTOR)** Deduplicar el fragmento de columnas mínimas y el filtro `deleted_at IS NULL` dentro del repositorio; confirmar suites verdes.

## 3. `ReportesRepository`: agregados de facturación

- [x] 3.1 **(RED)** En `backend/tests/reportes_facturacion.test.ts`, escribir escenarios de repositorio: `ingresosPorAplicadoEn(desde, hasta)` devuelve `cobros`, `anulaciones`, `cantidad` y `medio` agrupados por `aplicado_en`; une con `pago` para obtener `medio`; un movimiento cuyo `fecha_contable` difiere de `aplicado_en` se agrupa por `aplicado_en`. Verificación: los escenarios fallan.
- [x] 3.2 **(GREEN)** Implementar `ingresosPorAplicadoEn` en `reportes.repository.ts` con el `JOIN pago` y `SUM(CASE WHEN tipo = ...)` según design D5. Verificación: escenarios de 3.1 verdes.
- [x] 3.3 **(TRIANGULATE)** Agregar escenarios de movimiento con `motivo_asignacion = 'fecha_ya_cerrada'`, de cobro sin anulación, de anulación sin cobro previo en el rango y de los cinco medios cubiertos. Verificación: escenarios verdes.
- [x] 3.4 **(REFACTOR)** Extraer el `CASE` de neteo a una constante SQL del repositorio y confirmar que la suite sigue verde.

## 4. `ocupacion.service.ts`

- [x] 4.1 **(RED)** En `backend/tests/reportes_ocupacion.test.ts`, escribir escenarios de servicio: suma exacta de minutos; exclusión de `cancelado`/`ausente`/soft-deleted; `total.turnos` correcto; `series` por `dia`, `semana` y `mes`; turno `2026-11-02T02:30:00.000Z` agrupado en `2026-11-01` con `America/Buenos_Aires`; `series` sin relleno de ceros; respuesta con `zona_horaria`. Verificación: los escenarios fallan.
- [x] 4.2 **(GREEN)** Implementar `backend/src/reportes/ocupacion.service.ts` orquestando repositorio + `periodo.ts`, con desglose por profesional y sillón ordenado por `minutos_ocupados` descendente. Verificación: escenarios de 4.1 verdes.
- [x] 4.3 **(TRIANGULATE)** Agregar escenarios de período vacío (`total` en ceros, arrays vacíos), de filtro por `profesional_id` y por `sillon_id`, y de dos profesionales donde la suma de los desgloses iguala el total. Verificación: escenarios verdes.
- [x] 4.4 **(REFACTOR)** Extraer el acumulador común (`Map` por clave → `{turnos, minutos}`) a un helper del módulo y confirmar verde.

## 5. `ausentismo.service.ts`

- [x] 5.1 **(RED)** En `backend/tests/reportes_ausentismo.test.ts`, escribir escenarios de servicio: 2 ausentes sobre 10 resueltos → `tasa_ausentismo_pct: 20`; turnos abiertos fuera del denominador; cancelados fuera de numerador y denominador; denominador cero → `null`; redondeo half-up (1/8 → 13 y 1/16 → 6); 3/3 → 100 y 0/4 → 0; `series` diaria con tasa por bucket; agrupación en día local. Verificación: los escenarios fallan.
- [x] 5.2 **(GREEN)** Implementar `backend/src/reportes/ausentismo.service.ts` con la tasa entera derivada y `null` cuando `resueltos = 0`, reutilizando `periodo.ts`. Verificación: escenarios de 5.1 verdes.
- [x] 5.3 **(TRIANGULATE)** Agregar escenarios de `por_profesional` con tasas independientes, de bucket sin resueltos ausente de `series`, y de rango vacío. Verificación: escenarios verdes.
- [x] 5.4 **(REFACTOR)** Unificar el cálculo de tasa en una función pura única usada por total, series y desglose; confirmar verde y `npm run typecheck`.

## 6. `facturacion.service.ts`

- [x] 6.1 **(RED)** En `backend/tests/reportes_facturacion.test.ts`, escribir escenarios de servicio: neto = cobros − anulaciones; `por_medio` con los cinco medios presentes y neteados; `bolsillo_centavos` + `obra_social_centavos` = `ingresos_netos_centavos`; `total.cobros.cantidad` y `total.anulaciones.cantidad`; `series` por `dia`, `semana` y `mes`; período vacío con ceros y `series: []`; filtro por `medio`; medio inválido → `400`. Verificación: los escenarios fallan.
- [x] 6.2 **(GREEN)** Implementar `backend/src/reportes/facturacion.service.ts` con agregación sobre las filas del repositorio, montos enteros (R2) y claves de grupo derivadas de `aplicado_en`. Verificación: escenarios de 6.1 verdes.
- [x] 6.3 **(TRIANGULATE)** Agregar escenario de conciliación: el neto por medio de un `aplicado_en` coincide con el total del `cierre_caja` de ese día; y escenario de montos grandes sin pérdida de precisión. Verificación: escenarios verdes.
- [x] 6.4 **(REFACTOR)** Extraer el mapa de medios a una constante tipada compartida y confirmar verde.

## 7. RBAC y errores tipados

- [x] 7.1 **(RED)** En `backend/tests/reportes_routes.test.ts`, escribir escenarios de `puedeVerReportesOperativos` y `puedeVerReporteFacturacion` para los tres roles, y de `ReportesError.toBody()` (validación con `detalle`, forbidden sin `detalle`). Verificación: los escenarios fallan.
- [x] 7.2 **(GREEN)** Implementar en `backend/src/shared/auth.ts` las constantes `ROLES_REPORTES_OPERATIVOS`, `ROLES_REPORTES_FACTURACION` y los helpers; implementar `ReportesError` en `backend/src/shared/errors.ts`. Verificación: escenarios de 7.1 verdes.
- [x] 7.3 **(TRIANGULATE)** Agregar escenarios de `profesional` sin `usuario.profesional_id` (403) y de `recepcion` en facturación (403). Verificación: escenarios verdes.
- [x] 7.4 **(REFACTOR)** Leer el alcance del profesional desde `getAuth(res).profesionalId` (ya resuelto por `requireAuth`) en lugar de volver a consultar la BD; confirmar verde.

## 8. Rutas HTTP y montaje en `/api`

- [x] 8.1 **(RED)** En `backend/tests/reportes_routes.test.ts`, escribir escenarios con `supertest` sobre `createApp`: `GET /api/reportes/ocupacion` responde `200` con el contrato de design D7 y `zona_horaria`; `GET /api/reportes/facturacion` responde `200` solo para `administracion`; `GET /api/reportes/ausentismo` responde `200`; `400` por fecha inválida, rango invertido, rango > 366 días, `granularidad` y `medio` inválidos; `401` sin token; `403` según rol; ausencia de PHI en cuerpos de error. Verificación: los escenarios fallan (ruta no montada).
- [x] 8.2 **(GREEN)** Implementar `backend/src/reportes/reportes.routes.ts` (auth, RBAC, alcance por profesional, parseo y mapeo `snake_case`) y montarlo en `backend/src/shared/app.ts` con `app.use('/api', reportesRouter(db, config))`. Verificación: escenarios de 8.1 verdes.
- [x] 8.3 **(TRIANGULATE)** Agregar escenarios de query con parámetros desconocidos ignorados, de `granularidad` omitida que cae en `dia`, y de `series` ordenada ascendente. Verificación: escenarios verdes.
- [x] 8.4 **(REFACTOR)** Extraer el parseo de query a un helper local de la ruta y confirmar `npx vitest run tests/reportes_routes.test.ts` verde.

## 9. Verificación y cierre del change

- [x] 9.1 Ejecutar `npm run typecheck` en `backend/` y confirmar cero errores sin `any` nuevos (R10). Verificación: comando exitoso.
- [x] 9.2 Ejecutar `npm test` en `backend/` y confirmar toda la suite verde, incluidos los tests nuevos y los existentes de `agenda`, `caja` y `obras-sociales` (R11). Verificación: comando exitoso.
- [x] 9.3 Auditar reglas duras: R1/R12 (fixtures ficticios, SQLite real), R2/R5 (montos enteros en centavos), R6 (tasa entera 0..100), R8 (SQL solo en `reportes.repository.ts`), R3 (sin PHI en cuerpos ni logs). Verificación: revisión de `git diff` sin hallazgos.
- [x] 9.4 Confirmar que no se agregaron migraciones, columnas, índices ni dependencias: `git status` no muestra cambios en `backend/src/shared/migrations.ts`, `frontend/`, `package.json` ni `package-lock.json`. Verificación: listado de archivos modificados acotado a los declarados en `proposal.md`.
- [x] 9.5 Marcar `[C-14]` como `[x]` en `CHANGES.md` y confirmar que la governance quedó registrada como LOW. Verificación: línea de estado y governance actualizadas.

## Workflow follow-up

- Solicitar la revisión de gobernanza **LOW** de C-14 antes de archivar (read-only, sin migraciones).
- Verificar que C-13 (`comisiones-profesional`) siga pendiente y confirmar que C-14 no lo requiere al no exponer rentabilidad.
- Archivar con `/opsx:archive c-14-reportes-ocupacion-facturacion-ausentismo` y comprobar que `openspec/specs/reportes/{ocupacion,facturacion,ausentismo}/spec.md` quedaron creados.
