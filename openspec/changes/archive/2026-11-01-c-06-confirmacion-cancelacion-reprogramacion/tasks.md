# Tasks — C-06 confirmacion-cancelacion-reprogramacion

## Identificador
- Change: `C-06 confirmacion-cancelacion-reprogramacion`
- Fecha: 2026-11-01
- Estado: `planificado` (pendiente de aprobación antes de implementar)

## Tareas de implementación (orden sugerido)

| # | Tarea | Archivos | Estado |
|---|-------|----------|--------|
| T-01 | Agregar migración 006: tabla `turno_token` | `backend/src/shared/migrations.ts` | pendiente |
| T-02 | Agregar configuración TTL de token en `config.ts` | `backend/src/shared/config.ts` | pendiente |
| T-03 | Crear servicio de tokens de acción (`turnoToken.service.ts`) | `backend/src/agenda/turnoToken.service.ts` | pendiente |
| T-04 | Crear rutas públicas de acción (`turnoToken.routes.ts`) | `backend/src/agenda/turnoToken.routes.ts` | pendiente |
| T-05 | Montar rutas públicas de token en `app.ts` | `backend/src/shared/app.ts` | pendiente |
| T-06 | Escribir tests Vitest Dado/Cuando/Entonces | `backend/tests/turno_token.test.ts` | pendiente |
| T-07 | Ejecutar `tsc --noEmit` y `npm test` verdes | — | pendiente |
| T-08 | Cambiar checkbox C-06 a `[x]` en CHANGES.md | `CHANGES.md` | pendiente |

## Detalle por tarea

### T-01 — Migración 006 (`migrations.ts`)
- Añadir `MIGRATION_006_TURNO_TOKEN` con la tabla `turno_token`:
  - `id TEXT PRIMARY KEY`
  - `turno_id TEXT NOT NULL REFERENCES turno(id)`
  - `token_hash TEXT NOT NULL UNIQUE`
  - `accion TEXT NOT NULL CHECK (accion IN ('confirmar', 'cancelar', 'reprogramar'))`
  - `expires_at TEXT NOT NULL`
  - `usado_en TEXT` (NULL = no usado)
  - `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`
- Índices: `idx_turno_token_turno(turno_id)`, `idx_turno_token_valido(token_hash, usado_en, expires_at)`
- Agregar `{ id: '006', sql: MIGRATION_006_TURNO_TOKEN }` al array `MIGRATIONS` (orden ascendente).
- Seguir el patrón de idempotencia (`IF NOT EXISTS`) de las migraciones previas.

### T-02 — Configuración (`config.ts`)
- Agregar a `ReservaOnlineConfig` (o nueva sección) el campo:
  - `turnoTokenTtlSeconds: number` — leído de `TURN_TOKEN_TTL_SECONDS` con default `7 * 24 * 60 * 60` (7 días, ficticio [Supuesto]).
- Usar `positiveInt` para validación (patrón existente en C-05).
- No hardcodear secretos; solo valores numéricos de configuración.

### T-03 — Servicio (`turnoToken.service.ts`)
- Interfaz `AccionTurnoInput`: turnoId, accion ('confirmar'|'cancelar'|'reprogramar'), token, nuevoInicio (opcional), nuevoFin (opcional).
- Flujo dentro de `UnitOfWork.runInTransaction`:
  1. Hash del token entrante con `hashToken` (C-03).
  2. Buscar `turno_token` por `token_hash`. Si no existe → 401.
  3. Validar `expires_at >= ahora` → si expiró, 401.
  4. Validar `usado_en IS NULL` → si ya usado, 403.
  5. Validar que `turno_id` coincida con el turno solicitado y `accion` coincida con la acción → si no, 401.
  6. `turnos.findById(turnoId)` → 404 si no existe.
  7. `puedeTransicionar(actual.estado, nuevoEstado)` según `TRANSICIONES` (C-04) → 409 `transicion_invalida` si no.
  8. Validaciones por acción:
     - **confirmar**: `reservado → confirmado`. Sin restricciones extra.
     - **cancelar**: `reservado|confirmado → cancelado`. RN-06: `inicio - ahora >= turnoTokenTtlSeconds`? No — usar `anticipacionMinSegundos` de `config.reservaOnline`. Si `inicio - ahora < anticipacionMinSegundos` → 400 `eje: 'anticipacion'`.
     - **reprogramar**: `reservado → cancelado` (marcar actual como cancelado) + crear turno nuevo con `origen = 'online'`, `nuevo_inicio`, `nuevo_fin`. Validar solape profesional/sillón/bloqueo del nuevo turno (reusa `TurnoRepository.existeSolapeProfesional/Sillon` + `BloqueoRepository.existeBloqueoAplicable`) → 409 `eje: 'profesional'/'sillon'/'bloqueo'`.
  9. Marcar token como usado: `usado_en = ahora`.
  10. `turnos.actualizarEstado(turnoId, estadoEsperado, estadoNuevo)` (CAS). Si falla (concurrencia) → 409.
  11. Si es reprogramar: insertar turno nuevo.
  12. Log sin PHI: `turno ${accion} id=${turnoId} token consumido`.
- Usar errores `CrearTurnoError`/`TurnoEstadoError` existentes (C-04).

### T-04 — Rutas (`turnoToken.routes.ts`)
- Router Express sin `requireAuth` ni `requireRoles`.
- `POST /turnos/:id/confirmar`: leer `req.query.token`, llamar servicio con accion='confirmar', responder `200` `{id, estado}`.
- `POST /turnos/:id/cancelar`: igual con accion='cancelar'.
- `POST /turnos/:id/reprogramar`: leer `req.query.token` + cuerpo `{nuevo_inicio, nuevo_fin}`, llamar servicio con accion='reprogramar', responder `200` `{id, estado}`.
- Middleware de rate limiting público (reuso de `publicRateLimiterMiddleware` de C-05).
- Capturar errores y llamar `next(err)`.
- Cuerpos de error sin PHI.

### T-05 — Montaje (`app.ts`)
- Importar `turnoTokenRouter`.
- `app.use('/api/public', turnoTokenRouter(db, config));` — se fusiona con el router público de C-05 (ambos bajo `/api/public`).

### T-06 — Tests (`turno_token.test.ts`)
- SQLite real en memoria (`openDatabase(':memory:')`), sin mock de transacción (R12).
- Fixtures ficticios: 1 profesional, 1 sillón, 1 paciente, 1 turno `reservado`.
- Crear tokens de prueba insertando directamente en `turno_token` con `hashToken`.
- Escenarios (ver design §7):
  1. confirmar válido → 200, estado `confirmado`
  2. turno ya confirmado + token de confirmar → 409 `transicion_invalida`
  3. cancelar válido con anticipación → 200, estado `cancelado`
  4. cancelar sin anticipación (dentro de ventana) → 400 `eje: 'anticipacion'`
  5. token expirado → 401
  6. token inválido → 401
  7. token ya usado → 403
  8. token de otra acción → 401
  9. reprogramar válido sin solape → 200, original `cancelado`, nuevo `reservado` origen `online`
  10. reprogramar con solape profesional → 409 `eje: 'profesional'`
  11. turno inexistente → 404
  12. error sin PHI (cuerpo 409 solo `eje` e ids opacos)
- Formato Dado/Cuando/Entonces en cada `it()`.
- Test de concurrencia opcional: dos confirmaciones concurrentes del mismo turno → una 200, otra 409.

### T-07 — Verificación
- `npx tsc --noEmit` (TypeScript estricto, sin `any` sin justificar — R10).
- `npm test` (Vitest) verde (todos los tests, incluidos los preexistentes).
- R1: sin datos reales en fixtures/seed.
- R2: montos en centavos enteros (N/A para C-06).
- R3: sin PHI en logs/errores.

### T-08 — CHANGES.md
- Cambiar `[ ]` por `[x]` en C-06 dentro de `CHANGES.md` (FASE 2).

---

## Criterios de definición de "done"
- [ ] T-01 a T-06 completas y verificadas.
- [ ] T-07: `tsc --noEmit` + `npm test` verdes.
- [ ] T-08: checkbox C-06 marcado en CHANGES.md.
- [ ] Estado del change: listo para archivar (`/opsx:archive`).

---

¿Apruebo estas tasks para proceder a la **implementación** (apply)?

Responder: **Sí, continuar a implementar (apply)** / **No, ajustar tasks**.
