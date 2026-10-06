# Tasks — c-04-agenda-turnos-overlaps

## 1. Supuestos y base

- [x] 1.1 Verificar contra el repo los contratos [Supuesto] de C-01/C-02/C-03 (scaffolding, migraciones 001-002, `BaseRepository`+`UnitOfWork`+`AuditMixin`, middleware JWT/RBAC, brand types) y registrar el resultado como verificación que bloquea o habilita el resto (humo: `npx tsc --noEmit` corre sobre la base existente)
- [x] 1.2 Definir tipos de dominio con brand types (`TurnoId`, `ProfesionalId`, `SillonId`, `PacienteId`) y verificar que `npx tsc --noEmit` pasa sin `any` injustificado

## 2. Migración e índices

- [x] 2.1 Escribir migración 003 con tablas mínimas del change (`turno`, `bloqueo` si no existen) + `CHECK (fin > inicio)` y verificar que aplica limpia sobre SQLite en memoria
- [x] 2.2 Agregar índices `idx_turno_prof_intervalo (profesional_id, inicio, fin)`, `idx_turno_sillon_intervalo (sillon_id, inicio, fin)`, `idx_bloqueo_aplicabilidad` y verificar con `EXPLAIN QUERY PLAN` que la consulta de intersección usa índice

## 3. Repositorios (solo vía BaseRepository + UnitOfWork)

- [x] 3.1 Implementar `TurnoRepository extends BaseRepository<Turno>` con método `existeSolape(profesionalId|sillonId, inicio, fin)` (`inicio < nuevo_fin AND fin > nuevo_inicio`, estados activos) y verificar con test de repositorio en SQLite real en memoria
- [x] 3.2 Implementar lector `BloqueoRepository.existeBloqueoAplicable(profesionalId, sillonId, inicio, fin)` (NULL = global) y verificar con test de repositorio en SQLite real en memoria

## 4. Servicio y endpoint

- [x] 4.1 Implementar servicio `crearTurno()` con flujo `BEGIN IMMEDIATE` → validar entrada → RBAC → intersección profesional → sillón → bloqueos → insert `reservado` → commit, errores 400/403/409 con `eje` e ids opacos sin PHI, y verificar con test de servicio (SQLite real, sin mock de transacción)
- [x] 4.2 Exponer `POST /api/turnos` interno (auth C-03 [Supuesto], validación UTC ISO 8601, normalización de zona horaria) y verificar con test de endpoint que un payload válido devuelve 201 `reservado`
- [x] 4.3 Verificar que las respuestas 400/403/409 y los logs contienen solo UUIDs/ids opacos, sin nombres, DNI, teléfonos ni historia clínica (revisión de PHI, R3)

## 5. Tests de escenarios (Vitest Dado/Cuando/Entonces, SQLite real en memoria, fixtures ficticios)

- [x] 5.1 Escenario profesional libre → 201 `reservado`, verificado con `npx vitest run` en verde
- [x] 5.2 Escenario solape mismo profesional → 409 `eje=profesional`, verificado con `npx vitest run` en verde
- [x] 5.3 Escenario solape mismo sillón (otro profesional) → 409 `eje=sillon`, verificado con `npx vitest run` en verde
- [x] 5.4 Escenario turno `cancelado` libera hueco → 201, verificado con `npx vitest run` en verde
- [x] 5.5 Escenario bloqueo vigente intersectado → 409 `eje=bloqueo`, verificado con `npx vitest run` en verde
- [x] 5.6 Escenario `fin <= inicio` → 400 validación, verificado con `npx vitest run` en verde
- [x] 5.7 Escenario borde contiguo (`fin == inicio`) → 201, verificado con `npx vitest run` en verde
- [x] 5.8 Escenario concurrencia (doble escritura simultánea mismo hueco, SQLite real sin mock) → un 201 + un 409 y un único turno persistido, verificado con `npx vitest run` en verde

## 6. Cierre

- [x] 6.1 Correr `npx tsc --noEmit` y `npx vitest run` completos en verde y verificar que no hay tareas de UI ni dependencias fuera del MVP (R13) antes de declarar done
