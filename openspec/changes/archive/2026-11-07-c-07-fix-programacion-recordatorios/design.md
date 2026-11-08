# Design — c-07-fix-programacion-recordatorios

## Context

Ver `proposal.md` para la motivación. Estado actual que condiciona el diseño:

- `backend/src/notificaciones/recordatorio.worker.ts` ya implementa `programarRecordatoriosParaTurno(db, turnoId, inicioTurno, config)`: calcula T-48h/T-24h, descarta hitos vencidos, evita duplicados por `(turno_id, tipo)` y escribe dentro de `new UnitOfWork(db).runInTransaction(...)`.
- Búsqueda en `backend/`: la única referencia a `programarRecordatoriosParaTurno` fuera de su definición es `backend/tests/recordatorio.test.ts`. **Cero llamadores en `backend/src/`.**
- `UnitOfWork.runInTransaction` (`backend/src/shared/repository.ts:169-183`) ejecuta `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` directos, **sin soporte de anidamiento**.
- Envoltorios transaccionales existentes:
  - `crearTurno` (`agenda/crearTurno.service.ts:79`) envuelve **todo** su cuerpo en `runInTransaction`.
  - `reservarTurnoOnline` (`agenda/reservaOnline.service.ts:63`) envuelve **todo** su cuerpo en `runInTransaction`.
  - `ejecutarAccionTurno` (`agenda/turnoToken.service.ts:60`) envuelve **todo** su cuerpo en `runInTransaction`.
  - `cambiarEstadoTurno` (`agenda/turnoEstado.service.ts`) **no** abre transacción: usa `TurnoRepository.actualizarEstado` con CAS.
- `cambiarEstadoTurno` y `ejecutarAccionTurno` ya llaman `cancelarRecordatoriosDeTurno` al cancelar/ausente/reprogramar. Es un `UPDATE` simple, sin `BEGIN`, por eso hoy no hay anidamiento.
- La tabla `recordatorio` (migración 007) tiene índices **no únicos** `idx_recordatorio_estado_fecha` e `idx_recordatorio_turno_tipo`. La idempotencia es lógica (SELECT previo dentro de la misma transacción), como pidió C-07.
- `recordatorio.routes.ts` está montado en `createApp` (`shared/app.ts:39`) y expone `POST /api/public/recordatorios/procesar` y `GET /api/public/recordatorios/pendientes`.
- `turnosRouter` hoy recibe `AuthConfig`; `createApp` le pasa el `AppConfig` completo, que es estructuralmente asignable a `AuthConfig`.

Restricciones duras aplicables: R3 (sin PHI), R8 (SQL solo en repositorios), R9 (`BEGIN IMMEDIATE` en escrituras de agenda), R10 (TS estricto), R11 (escenarios Vitest Dado/Cuando/Entonces), R12 (SQLite real, sin mockear transacciones), R16 (governance MEDIUM: checkpoints y decisiones explícitas).

## Goals / Non-Goals

**Goals:**

- Que todo turno creado o confirmado con inicio futuro tenga sus recordatorios programados en la app real.
- Que la reprogramación deje el turno nuevo con recordatorios del nuevo inicio y cancele los del anterior.
- Resolver el anidamiento de transacciones sin tocar `UnitOfWork` ni las garantías de concurrencia de C-04.
- Que un fallo de notificaciones no degrade la operación de agenda (crear/confirmar turnos).
- Dejar escenarios que prueben el **cableado real**, no la función aislada.

**Non-Goals:**

- Refactor del worker a `BaseRepository`/`RecordatorioRepository` (deuda R8 preexistente).
- Índice `UNIQUE(turno_id, tipo)` o cualquier cambio de esquema.
- Cron interno, reintentos con backoff, segundo recordatorio por falta de respuesta, plantillas y envío real por WhatsApp/E-mail.
- Cambiar la máquina de estados, el orden de validaciones, las reglas de solapamiento ni los códigos HTTP existentes.

## Decisions

### D1 — Cableado post-commit, best-effort, en los servicios de orquestación

Se programa **después** de que la transacción de agenda retorna, en el mismo servicio que ya orquesta el caso de uso:

| Punto de entrada | Momento del turno | Acción |
|---|---|---|
| `crearTurno` | turno creado `reservado` (recepción) | programar `creado.id` / `creado.inicio` |
| `reservarTurnoOnline` | turno creado `reservado` (C-05) | programar `creado.id` / `creado.inicio` |
| `cambiarEstadoTurno` | transición a `confirmado` | programar el turno ya actualizado |
| `ejecutarAccionTurno` `confirmar` | transición a `confirmado` (C-06) | programar el turno confirmado |
| `ejecutarAccionTurno` `reprogramar` | turno nuevo `reservado` | programar `turnoReprogramado` |

Forma del hook (único punto de entrada nuevo):

```ts
export function programarRecordatoriosSeguro(
  db: DatabaseSync,
  turnoId: string,
  inicioTurno: string,
  config: RecordatorioConfig,
): void
```

Envuelve `programarRecordatoriosParaTurno` en `try/catch`, nunca relanza y loguea solo ids opacos (D6).

Alternativas evaluadas:

- **(b) solo en `reservado → confirmado`**: descartada. Deja sin recordatorios a los turnos `reservado` que nunca se confirman y contradice el escenario 1 del alcance (crear → 2 pendientes). Peor: C-05 crea `reservado` y depende de que el paciente abra el link para confirmar; justamente el recordatorio es lo que promueve esa confirmación.
- **(c) refactor de `UnitOfWork` para transacciones anidadas/savepoints**: descartada. `UnitOfWork` es la primitiva que sostiene R9 y el anti-solapamiento de C-04 (governance CRITICAL). Introducir SAVEPOINTs, contadores de profundidad o paso de una `UnitOfWork` existente por parámetro cambia el contrato de la pieza más sensible del sistema para resolver un change MEDIUM de cableado, y obliga a re-verificar todos los escenarios de concurrencia. Costo/riesgo desproporcionado.
- **(d) cablear en las rutas HTTP** (`turnos.routes.ts`, `reservaOnline.routes.ts`, `turnoToken.routes.ts`): descartada. Mantiene los servicios puros y evita cambiar firmas, pero deja la regla de negocio fuera del servicio: cualquier caller no-HTTP (tests de integración, seeds, futuros jobs) vuelve a crear turnos sin recordatorios, que es exactamente el bug que estamos arreglando. También duplica el hook en tres routers.
- **(a) elegida**: servicio + post-commit. Es el único punto donde conviven el conocimiento del caso de uso y la garantía de estar fuera de la transacción.

### D2 — Por qué post-commit y no dentro de la transacción

`runInTransaction` no anida: un segundo `BEGIN IMMEDIATE` con una transacción abierta lanza `SQLITE_ERROR: cannot start a transaction within a transaction`. Por eso:

- En `crearTurno`, `reservarTurnoOnline` y `ejecutarAccionTurno` la programación ocurre **después** de que la transacción retorna.
- En `cambiarEstadoTurno` no hay transacción externa (CAS sobre una sola fila), así que la programación puede llamarse directo. Es el único punto donde “dentro del flujo” y “fuera de transacción” coinciden.

**Invariante que queda documentada en el código:** `cambiarEstadoTurno` no debe invocarse desde dentro de un `runInTransaction`. Si un caller futuro lo necesita, debe usar `programarRecordatoriosSeguro` post-commit en su lugar. Se deja como comentario junto a la llamada (no hay detección runtime barata en `node:sqlite` sin instrumentar `UnitOfWork`, que es lo que D1-c descarta).

### D3 — Semántica best-effort y reparación idempotente

Un fallo al programar **no** aborta ni revierte la creación/confirmación:

- `programarRecordatoriosSeguro` captura, loguea y retorna.
- La respuesta HTTP del turno no cambia (201 al crear, 200 al confirmar/reprogramar).
- La reparación es estructural: la programación es idempotente y se reintenta en el siguiente punto de orquestación (típicamente la confirmación), en el backfill operativo (D9) o al volver a invocar el flujo.

Trade-off aceptado: en la ventana entre el fallo y la reparación, el turno existe sin recordatorios. Se acepta porque (i) la integridad del turno y el anti-solapamiento no dependen de `recordatorio`; (ii) perder un recordatorio es recuperable, abortar una reserva por un fallo de notificaciones no lo es; (iii) R16 MEDIUM pide explícitamente surfacear esta decisión.

### D4 — Configuración obligatoria en las firmas (no opcional)

```ts
crearTurno(db, input, recordatorioConfig: RecordatorioConfig): TurnoCreado
reservarTurnoOnline(db, input, anticipacionMinSegundos, recordatorioConfig: RecordatorioConfig): TurnoReservado
cambiarEstadoTurno(db, input, recordatorioConfig: RecordatorioConfig): TurnoRow
```

- `RecordatorioConfig` se toma de `config.recordatorio` (ya existe: `t48hHoras`, `t24hHoras`, `canalPredeterminado`); **no** se agregan variables de entorno.
- Parámetro **requerido** a propósito: un parámetro opcional con default silencioso reintroduce la clase de bug que este change corrige (producción sin cablear y compilando igual). Con obligatorio, `tsc --noEmit` falla si alguien agrega un caller sin configurar notificaciones.
- `turnosRouter` pasa de `AuthConfig` a `AppConfig`; `createApp` ya entrega el `AppConfig` completo, así que no cambia el montaje.
- `ejecutarAccionTurno` ya recibe `AppConfig`; usa `config.recordatorio` sin cambio de firma.

### D5 — Idempotencia: se conserva la garantía lógica, sin índice único

- Se mantiene el dedupe de C-07: `SELECT 1 ... WHERE turno_id = ? AND tipo = ?` seguido de `INSERT`, **dentro** de `BEGIN IMMEDIATE`.
- Como `BEGIN IMMEDIATE` toma el lock de escritura, dos programaciones concurrentes se serializan: la segunda ve las filas de la primera y no inserta. La garantía es suficiente para el escenario “crear + confirmar + reintentar”.
- **No** se agrega `CREATE UNIQUE INDEX` en este change: el alcance habla de unicidad lógica, y agregar una migración a un follow-up de cableado amplía el riesgo sin un caso de uso que lo requiera. Queda registrado como deuda (Risks).

### D6 — Logging sin PHI (R3)

- Éxito: se conserva el log existente de envío (`id`, `turno`, `tipo`).
- Falla de programación: `console.error` con `turno=<uuid>` y el **nombre** del error (`SqliteError`, `Error`), nunca `err.message` (podría arrastrar valores bindeados) ni datos del paciente.
- Sin cambios en los cuerpos de error HTTP: `error-handler` ya devuelve `{ error: <code> }` sin stack.

### D7 — Deuda R8 del worker: se acepta, no se corrige acá

`recordatorio.worker.ts` usa `db.prepare` directo en vez de `BaseRepository`. Este change:

- **No agrega SQL nuevo:** `programarRecordatoriosSeguro` solo envuelve la función existente; las escrituras de recordatorios ya estaban.
- **No mueve** las consultas a un `RecordatorioRepository`, para no mezclar un refactor estructural con un fix de comportamiento en un change MEDIUM. Mezclarlos haría el diff y la revisión más caros y dificultaría atribuir una regresión.
- Se registra como deuda aceptada; candidato natural a un change de refactor posterior, que requiere decisión del usuario (R13/R14: no se inventa alcance).

Única superficie de datos nueva: `TurnoRepository.listarFuturosActivos(desdeIso)` para el backfill (D9), que vive en el repositorio y respeta R8.

### D8 — Tests: flujos reales, SQLite real, fallo inyectado sin mocks

- Todos los escenarios usan `openDatabase(':memory:')` y fixtures ficticios (R1/R12).
- Los escenarios de cableado llaman a `crearTurno`, `reservarTurnoOnline`, `cambiarEstadoTurno` y `ejecutarAccionTurno`, no a `programarRecordatoriosParaTurno` directamente. Así una regresión de cableado hace fallar el test (hoy no lo haría).
- **Fallo de programación**: se crea un trigger real en SQLite
  `CREATE TRIGGER ... BEFORE INSERT ON recordatorio BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END;`
  y se verifica que el turno se crea/confirma igual y que no hay filas. Se elimina el trigger al final del escenario. Es una falla real de SQLite, no un mock de la capa transaccional (R12).
- Fechas siempre relativas (`Date.now() ± N`) para evitar el problema de fixtures caducados ya corregido.

### D9 — Backfill operativo de una sola vez (idempotente)

Los turnos futuros ya existentes en una base real fueron creados mientras la programación estaba muerta y no se van a re-confirmar (un turno `confirmado` no vuelve a pasar por la transición). Para no dejar ese hueco:

- `backend/src/shared/recordatorio-backfill-cli.ts` recorre `TurnoRepository.listarFuturosActivos(ahora)` (estados `reservado`/`confirmado`, `deleted_at IS NULL`) y llama `programarRecordatoriosSeguro` por turno.
- `npm run backfill:recordatorios` (nuevo script, mismo patrón que `seed`).
- Es idempotente por D5: correrlo dos veces no duplica; los hitos vencidos se omiten por la regla de C-07.
- No es un requisito de comportamiento permanente: es un paso de deploy. No agrega requirements a la delta spec.

### D10 — Orden dentro de cada servicio

- `crearTurno`: `const creado = runInTransaction(...)` → `programarRecordatoriosSeguro(...)` → `return creado`.
- `reservarTurnoOnline`: idéntico.
- `cambiarEstadoTurno`: CAS → (si terminal) cancelar → (si `confirmado`) leer la fila y programar → `return`.
- `ejecutarAccionTurno`: `const resultado = runInTransaction(...)` → si `confirmar` programar `input.turnoId`; si `reprogramar` programar `resultado.turnoReprogramado` (leyendo `inicio` con `TurnoRepository.findById`) → `return resultado`.
  No se agregan campos al tipo de retorno HTTP: el `inicio` se relee post-commit, evitando filtrar datos internos a la respuesta pública.

## Risks / Trade-offs

- **[Turno sin recordatorios si falla la programación post-commit]** → La idempotencia permite reparar en la confirmación, en el backfill o al reprocesar; el fallo se loguea con ids opacos y nunca rompe la agenda. Trade-off aceptado en D3.
- **[`SQLITE_BUSY` en la programación si otro proceso tiene el lock]** → `programarRecordatoriosSeguro` lo traga igual que cualquier fallo; el turno queda válido y la reparación posterior cubre el hueco. No se agrega retry en request para no alargar la latencia de agenda.
- **[Sin `UNIQUE(turno_id, tipo)`]** → la unicidad depende de que la programación siga corriendo dentro de `BEGIN IMMEDIATE`. Si un refactor futuro la saca de la transacción, podrían duplicarse. Mitigación: escenario de idempotencia explícito y deuda registrada.
- **[Programar en `reservado` puede generar recordatorios de turnos que nunca se confirmen]** → es el comportamiento deseado (el recordatorio promueve la confirmación) y se cancelan al cancelar/ausente. Se surfacea por ser un cambio de énfasis respecto de la redacción original de C-07 (“turnos confirmados”).
- **[Deuda R8 en el worker]** → aceptada y acotada en D7; este change no agrega SQL fuera de repositorios salvo el método nuevo de `TurnoRepository`.
- **[Cambio de firmas rompe call sites de tests]** → es intencional: el compilador impide volver al estado sin cablear. Los tests se actualizan en el mismo change (R11: suite verde antes de done).
- **[Backfill sobre bases grandes]** → recorre solo turnos futuros activos y es idempotente; en este proyecto el volumen es mínimo. Si creciera, se pagina por `inicio`.

## Migration Plan

1. **Sin migración de esquema.** La tabla `recordatorio` y sus índices ya existen desde 007.
2. Deploy del código con los hooks post-commit y las firmas nuevas.
3. Ejecutar el backfill operativo **una vez** por base: `npm run backfill:recordatorios`. Verificación: `GET /api/public/recordatorios/pendientes` devuelve filas para turnos futuros; correrlo de nuevo no incrementa el total.
4. **Rollback:** revertir el deploy. Las filas creadas son compatibles con el esquema de C-07 y no requieren limpieza; si se quisiera neutralizarlas sin tocar datos, basta con no exponer `POST /recordatorios/procesar` (el envío sigue siendo simulado). No hay migración que deshacer.

## Open Questions

- Canal por paciente (hoy `canalPredeterminado` es global): no cambia specs ni el approach; queda para una integración posterior de C-07.
- Segundo recordatorio ante falta de respuesta (mencionado en FL-03): ya estaba fuera de alcance en C-07 y sigue fuera.
