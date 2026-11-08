# Tasks — c-07-fix-programacion-recordatorios

Cada grupo sigue TDD RED → GREEN → TRIANGULATE → REFACTOR. Los tests usan SQLite real en
memoria (`openDatabase(':memory:')`), fixtures ficticios (R1/R12) y nombres
`Dado/Cuando/Entonces` (R11). Verificación transversal: `npm run typecheck`
(`tsc --noEmit`) y `npx vitest run`.

## 1. Wrapper best-effort de programación

- [x] 1.1 **(RED)** En `backend/tests/recordatorio.test.ts`, agregar escenarios de `programarRecordatoriosSeguro`: (a) con config válida y turno futuro crea los mismos dos pendientes que la función base; (b) con un trigger real `BEFORE INSERT ON recordatorio ... RAISE(ABORT)` no lanza excepción, no deja filas y el turno sigue existiendo. Verificación: (b) falla con el código actual (no existe el wrapper).
- [x] 1.2 **(GREEN)** Implementar `programarRecordatoriosSeguro(db, turnoId, inicioTurno, config)` en `backend/src/notificaciones/recordatorio.worker.ts`: `try { programarRecordatoriosParaTurno(...) } catch { log }` sin relanzar (design D1/D3). Verificación: escenarios de 1.1 verdes.
- [x] 1.3 **(TRIANGULATE)** Agregar escenarios: llamar el wrapper dos veces no duplica (2 filas); el log de fallo incluye el `turno_id` y el nombre del error y **no** contiene datos del paciente ni `err.message` (espía sobre `console.error`, sin mockear la transacción). Verificación: escenarios verdes.
- [x] 1.4 **(REFACTOR)** Unificar el formato de log operativo del módulo y confirmar `npm run typecheck` sin `any` (R10).

## 2. Cableado en la creación de turnos

- [x] 2.1 **(RED)** En `backend/tests/crear_turno.test.ts` y `backend/tests/reserva_online.test.ts`, agregar escenarios de servicio: `crearTurno` con inicio a +7 días deja el turno `reservado` y dos recordatorios `pendiente`; `reservarTurnoOnline` (origen `online`) hace lo mismo; inicio a +1 hora no crea recordatorios; un trigger de fallo no aborta la creación y el turno queda persistido. Verificación: los escenarios fallan (no hay cableado).
- [x] 2.2 **(GREEN)** Añadir `recordatorioConfig: RecordatorioConfig` como parámetro requerido a `crearTurno` y `reservarTurnoOnline`, capturar el resultado de `runInTransaction` en una constante y llamar `programarRecordatoriosSeguro` **después** del commit (design D1/D2/D4). Actualizar `backend/src/agenda/turnos.routes.ts` (firma `AppConfig`) y `backend/src/agenda/reservaOnline.routes.ts` para pasar `config.recordatorio`. Verificación: escenarios de 2.1 verdes y `npm run typecheck` limpio.
- [x] 2.3 **(TRIANGULATE)** Agregar escenarios: con `canalPredeterminado = 'email'` ambos recordatorios usan `email`; con inicio a +30 horas sólo se crea `recordatorio_24h`. Verificación: escenarios verdes.
- [x] 2.4 **(REFACTOR)** Extraer un helper de fixtures de recordatorios (seed + lectura de filas) reutilizable y confirmar verdes `crear_turno.test.ts` y `reserva_online.test.ts`.

## 3. Cableado en la confirmación

- [x] 3.1 **(RED)** En `backend/tests/turno_estado.test.ts` y `backend/tests/turno_token.test.ts`, agregar escenarios: `cambiarEstadoTurno` de `reservado` a `confirmado` sin recordatorios los crea; con recordatorios ya existentes no duplica; `ejecutarAccionTurno` con `accion='confirmar'` programa los hitos del turno. Verificación: los escenarios fallan.
- [x] 3.2 **(GREEN)** Añadir `recordatorioConfig` a `cambiarEstadoTurno` y programar cuando `nuevoEstado === 'confirmado'`, después del CAS y de la cancelación (no hay transacción externa, design D2). En `ejecutarAccionTurno`, programar post-commit cuando `accion === 'confirmar'`, releyendo `inicio` con `TurnoRepository.findById` (design D10). Verificación: escenarios de 3.1 verdes y `npm run typecheck` limpio.
- [x] 3.3 **(TRIANGULATE)** Agregar escenarios: confirmar un turno con inicio a +1 hora lo deja `confirmado` sin recordatorios; `confirmado → presente` no cancela ni altera recordatorios pendientes. Verificación: escenarios verdes.
- [x] 3.4 **(REFACTOR)** Unificar en los dos servicios el acceso a la fila post-commit y confirmar verdes `turno_estado.test.ts` y `turno_token.test.ts`.

## 4. Reprogramación completa

- [x] 4.1 **(RED)** En `backend/tests/turno_token.test.ts`, agregar escenarios: reprogramar un turno con pendientes a +7 días deja los del turno anterior `cancelado`, el turno nuevo `reservado` y con dos `pendiente` calculados desde el nuevo inicio; reprogramar a +1 hora deja los anteriores `cancelado` y el nuevo sin recordatorios. Verificación: los escenarios fallan (hoy sólo se cancela).
- [x] 4.2 **(GREEN)** En `ejecutarAccionTurno`, tras el commit de `accion='reprogramar'`, programar el turno `resultado.turnoReprogramado` leyendo su `inicio` con `TurnoRepository.findById` (design D10). Verificación: escenarios de 4.1 verdes.
- [x] 4.3 **(TRIANGULATE)** Agregar escenario donde el turno anterior tiene un recordatorio `enviado` y uno `pendiente`: el `enviado` conserva su estado, el `pendiente` pasa a `cancelado` y el turno nuevo se programa. Verificación: escenario verde.
- [x] 4.4 **(REFACTOR)** Confirmar que `turno_token.test.ts` completo y `recordatorio.test.ts` siguen verdes tras el cambio.

## 5. Backfill operativo idempotente (una sola vez por base)

- [x] 5.1 **(RED)** En `backend/tests/recordatorio.test.ts`, agregar escenarios de `TurnoRepository.listarFuturosActivos(desdeIso)`: devuelve sólo turnos con `inicio > desde`, en estado `reservado`/`confirmado` y `deleted_at IS NULL`; excluye pasados, cancelados/ausentes/atendidos y soft-deleted. Verificación: el escenario falla (método inexistente).
- [x] 5.2 **(GREEN)** Implementar `listarFuturosActivos` en `backend/src/agenda/turno.repository.ts` (SQL dentro del repositorio, R8). Verificación: escenario de 5.1 verde.
- [x] 5.3 **(RED/GREEN)** Agregar `programarRecordatoriosDeTurnosFuturos(db, config, ahoraIso): number` al worker (recorre `listarFuturosActivos` y llama `programarRecordatoriosSeguro`, devuelve cuántos turnos procesó) y su escenario: programa los futuros, ignora pasados y una segunda corrida no duplica filas. Verificación: escenario verde.
- [x] 5.4 **(GREEN)** Crear `backend/src/shared/recordatorio-backfill-cli.ts` (patrón de `seed-cli.ts`: `loadConfig` + `openDatabase`, `try/finally` con `close`) y el script `backfill:recordatorios` en `backend/package.json`; documentar el paso en `backend/README.md`. Verificación: `npm run typecheck` limpio y el comando compila/ejecuta sobre una base temporal sin error.
- [x] 5.5 **(REFACTOR)** Revisar que el CLI no loguee PHI (sólo conteos e ids opacos) y confirmar `recordatorio.test.ts` verde.

## 6. Integración HTTP y regresión del endpoint público

- [x] 6.1 **(RED)** En `backend/tests/recordatorio.test.ts`, agregar escenario de regresión del procesamiento: sembrar un `pendiente` vencido, un `pendiente` futuro y un `enviado`; `POST /api/public/recordatorios/procesar` responde `200` con un único procesado (el vencido) y los otros dos conservan su estado. Verificación: escenario verde con el código actual (protege la conducta de C-07).
- [x] 6.2 **(RED)** Agregar flujo HTTP completo: `POST /api/public/turnos` (reserva online, inicio futuro) responde `201` y `GET /api/public/recordatorios/pendientes` lista sus dos recordatorios; luego `POST /api/public/turnos/:id/cancelar` con token sembrado responde `200` y los pendientes dejan de listarse (`cancelado`). Verificación: escenario falla si falta cableado o cancelación.
- [x] 6.3 **(RED)** Agregar escenario de no-PHI: la respuesta de `GET /pendientes` y el log de una programación fallida contienen sólo ids, tipo y estado; no matchean nombre de paciente, DNI, teléfono ni historia clínica. Verificación: escenario verde.
- [x] 6.4 **(GREEN)** Corregir cualquier brecha de integración detectada sin cambiar códigos HTTP ni el orden de validaciones existente. Verificación: escenarios 6.1–6.3 verdes.

## 7. Verificación transversal y cierre del change

- [x] 7.1 Ejecutar `npm run typecheck` en `backend/` y confirmar cero errores y cero `any` nuevos (R10). Verificación: comando exitoso.
- [x] 7.2 Ejecutar `npx vitest run` en `backend/` y confirmar la suite completa verde, incluidos los tests preexistentes de C-04/C-05/C-06/C-07 (R11). Verificación: comando exitoso.
- [x] 7.3 Auditar logs y cuerpos de error agregados: sólo `turno_id`, `recordatorio_id`, tipo, estado y nombre de error (R3). Verificación: revisión con `grep -n "console\.\(log\|error\)" backend/src/notificaciones backend/src/agenda` sin PHI.
- [x] 7.4 Anotar el follow-up en la sección `[C-07]` de `CHANGES.md` (referencia a este change y a que el cableado quedó completo), sin crear un ítem nuevo de roadmap (R13/R14). Verificación: sección actualizada y legible.
- [x] 7.5 Checkpoint de governance MEDIUM (R16): registrar en la revisión que se aprobaron D1 (post-commit), D3 (best-effort) y D7 (deuda R8 aceptada). Verificación: decisión asentada antes de archivar.

## Workflow follow-up

- Archivar el change cuando el checkpoint MEDIUM de R16 esté aprobado: `/opsx:archive c-07-fix-programacion-recordatorios`.
- Verificar que `openspec/specs/notificaciones/recordatorios/spec.md` exista tras el archive (el delta es la primera spec de esa capability).

## Checkpoint de governance (R16) — aprobado por el usuario
- D1 (cableado post-commit en servicios de orquestación): aprobado 2026-11-06.
- D3 (best-effort: un fallo de programación no aborta la agenda): aprobado 2026-11-06.
- D7 (deuda R8 del worker aceptada; backfill como única superficie SQL nueva): aprobado 2026-11-06.
