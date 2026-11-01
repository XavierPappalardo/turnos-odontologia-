# Tasks — C-05 reserva-online

## Identificador
- Change: `C-05 reserva-online`
- Fecha: 2026-11-01
- Estado: `planificado` (pendiente de aprobación antes de implementar)

## Tareas de implementación (orden sugerido)

| # | Tarea | Archivos | Estado |
|---|-------|----------|--------|
| T-01 | Agregar configuración de reserva online (anticipación mínima, rate limit) a `config.ts` | `backend/src/shared/config.ts` | pendiente |
| T-02 | Crear rate limiter público por IP (`publicRateLimiter.ts`) | `backend/src/agenda/publicRateLimiter.ts` | pendiente |
| T-03 | Crear servicio de reserva online (`reservaOnline.service.ts`) reuso de C-04 | `backend/src/agenda/reservaOnline.service.ts` | pendiente |
| T-04 | Crear rutas públicas de reserva online (`reservaOnline.routes.ts`) | `backend/src/agenda/reservaOnline.routes.ts` | pendiente |
| T-05 | Montar rutas públicas en `app.ts` | `backend/src/shared/app.ts` | pendiente |
| T-06 | Escribir tests Vitest Dado/Cuando/Entonces | `backend/tests/reserva_online.test.ts` | pendiente |
| T-07 | Ejecutar `tsc --noEmit` y `npm test` verdes | — | pendiente |
| T-08 | Cambiar checkbox C-05 a `[x]` en CHANGES.md | `CHANGES.md` | pendiente |

## Detalle por tarea

### T-01 — Configuración (`config.ts`)
- Leer variables de entorno con fallbacks seguros:
  - `RESERVA_ONLINE_ANTICIPACION_MIN_SEGUNDOS` (default `7200` = 2 h, ficticio [Supuesto RN-06])
  - `RESERVA_ONLINE_RATE_MAX` (default `10`)
  - `RESERVA_ONLINE_RATE_WINDOW_SEGUNDOS` (default `60`)
- Exportar `config.reservaOnline` con esos valores.
- No hardcodear secretos; valores son numéricos de configuración.

### T-02 — Rate limiter público (`publicRateLimiter.ts`)
- Clase `PublicRateLimiter` similar a `LoginRateLimiter` (C-03) pero:
  - Clave = IP del cliente (`req.ip`).
  - Ventana y máx. intentos desde `config.reservaOnline`.
  - Método `intentar(key)` → `{allowed, retryAfterSeconds}`.
  - Método `limpiar()` oportunístico.
- Middleware Express que usa el limiter y responde `429` + header `Retry-After` cuando se excede.
- No loguear la IP (R3).

### T-03 — Servicio (`reservaOnline.service.ts`)
- Interfaz `ReservaOnlineInput`: profesionalId, sillonId, pacienteId, prestacionId (opcional), inicio, fin.
- Flujo dentro de `UnitOfWork.runInTransaction`:
  1. Validar campos obligatorios → 400 `validacion`.
  2. `normalizarUtc` (reusar función de `crearTurno.service.ts`) para inicio y fin.
  3. `fin > inicio` → 400.
  4. FKs existentes y activos: profesional, sillón, paciente (activo=1); prestación opcional (existencia) → 400.
  5. RN-06: `inicio >= ahora + anticipacionMinSegundos` → 400 `eje: 'anticipacion'`.
  6. `TurnoRepository.existeSolapeProfesional` → 409 `eje: 'profesional'`.
  7. `TurnoRepository.existeSolapeSillon` → 409 `eje: 'sillon'`.
  8. `BloqueoRepository.existeBloqueoAplicable` → 409 `eje: 'bloqueo'`.
  9. Insertar turno con `origen: 'online'` vía `TurnoRepository.crear`.
  10. Log sin PHI: `turno online creado id=<uuid>`.
- Usar errores `CrearTurnoError` existentes (C-04) o extender si hace falta `eje: 'anticipacion'` (tipo `EjeConflicto` ya permite `'profesional' | 'sillon' | 'bloqueo'`; agregar `'anticipacion'` si es necesario para tipado).

### T-04 — Rutas (`reservaOnline.routes.ts`)
- Router Express sin `requireAuth` ni `requireRoles`.
- `POST /turnos`: leer cuerpo, llamar servicio, responder `201` con turno creado.
- `GET /agenda/disponibilidad`: query `profesional_id`, `sillon_id`, `fecha`; devolver huecos libres de 30 min en 08:00–18:00 filtrados por solape y bloqueos (reuso de `existeSolapeProfesional`, `existeSolapeSillon`, `existeBloqueoAplicable`).
- Capturar errores y llamar `next(err)` para que `errorHandler` los traduzca a JSON.
- Cuerpos de error sin PHI.

### T-05 — Montaje (`app.ts`)
- Importar `reservaOnlineRouter`.
- `app.use('/api/public', reservaOnlineRouter(db, config));` tras las rutas privadas.

### T-06 — Tests (`reserva_online.test.ts`)
- SQLite real en memoria (`openDatabase(':memory:')`), sin mock de transacción (R12).
- Fixtures ficticios: 1 profesional, 1 sillón, 1 paciente, 1 prestación (opcional).
- Escenarios (ver design §7):
  1. Reserva exitosa → 201, estado `reservado`, origen `online`.
  2. Solape profesional → 409 `eje: 'profesional'`.
  3. Solape sillón → 409 `eje: 'sillon'`.
  4. Bloqueo aplicable → 409 `eje: 'bloqueo'`.
  5. fin <= inicio → 400.
  6. Dentro de ventana de anticipación → 400 `eje: 'anticipacion'`.
  7. Disponibilidad devuelve huecos libres.
  8. Sin anticipación mínima (ventana 0) → reserva inmediata permitida.
  9. Rate limit excedido → 429.
- Formato Dado/Cuando/Entonces en cada `it()`.

### T-07 — Verificación
- `npx tsc --noEmit` (TypeScript estricto, sin `any` sin justificar — R10).
- `npm test` (Vitest) verde.
- R1: sin datos reales en fixtures/seed.
- R2: montos en centavos enteros (N/A para C-05, pero vigente).
- R3: sin PHI en logs/errores.

### T-08 — CHANGES.md
- Cambiar `[ ]` por `[x]` en C-05 dentro de `CHANGES.md` (FASE 2).

---

## Criterios de definición de "done"
- [ ] T-01 a T-06 completas y verificadas.
- [ ] T-07: `tsc --noEmit` + `npm test` verdes.
- [ ] T-08: checkbox C-05 marcado en CHANGES.md.
- [ ] Estado del change: `archivado` (pasar a `/opsx:archive`).

---

¿Apruebo estas tasks para proceder a la **implementación** (apply)?

Responder: **Sí, continuar a implementar (apply)** / **No, ajustar tasks**.
