# Design — C-05 reserva-online

## Identificador
- Change: `C-05 reserva-online`
- Fecha: 2026-11-01
- Estado: `diseñado` (pendiente de aprobación antes de tasks)

## 1. Arquitectura de endpoints públicos

Todos los endpoints de C-05 viven bajo el prefijo **`/api/public`** y **no requieren autenticación JWT** (KB-08 §5: APIs públicos vs privados). Se montan en `app.ts` junto a `/api` (privado) sin `requireAuth`.

| Endpoint | Método | Público | Autenticación | Origen del turno |
|----------|--------|---------|---------------|------------------|
| `GET /api/public/agenda/disponibilidad` | GET | Sí | No | — (consulta) |
| `POST /api/public/turnos` | POST | Sí | No | `online` |

## 2. Diseño de rutas (`backend/src/agenda/reservaOnline.routes.ts`)

Sigue el patrón de `turnos.routes.ts` (C-04) pero:
- Sin `requireAuth` ni `requireRoles`.
- Cuerpo de `POST`: `profesional_id`, `sillon_id`, `paciente_id`, `prestacion_id` (opcional), `inicio`, `fin`.
- `GET /disponibilidad`: query params `profesional_id`, `sillon_id`, `fecha` (YYYY-MM-DD). Devuelve huecos libres de 30 min en horario laboral ficticio (08:00–18:00) filtrados por solape y bloqueos.
- Respuesta `POST`: `201` con `{id, profesional_id, sillon_id, paciente_id, inicio, fin, estado: 'reservado', origen: 'online'}`.
- Errores: `400` validación, `409` conflicto con `eje` (`profesional` / `sillon` / `bloqueo` / `anticipacion`), `429` rate limit. Cuerpos sin PHI (solo ids opacos + `eje`).

## 3. Servicio (`backend/src/agenda/reservaOnline.service.ts`)

Reusa la lógica de validación de C-04 sin duplicarla:

```ts
export interface ReservaOnlineInput {
  profesionalId: string;
  sillonId: string;
  pacienteId: string;
  prestacionId?: string | undefined;
  inicio: string;
  fin: string;
  ip?: string; // para rate limiting
}
```

Flujo dentro de `UnitOfWork.runInTransaction` (`BEGIN IMMEDIATE`):
1. Validar campos obligatorios (400).
2. Normalizar fechas a ISO 8601 UTC (mismo `normalizarUtc` de C-04).
3. `fin > inicio` (400).
4. FKs existentes y activos: profesional, sillón, paciente; prestación opcional (400).
5. **RN-06 anticipación mínima**: `inicio >= ahora + ventanaConfigurada` (400 con `eje: 'anticipacion'`). Ventana por defecto 2 horas (valor ficticio, configurable por variable de entorno `RESERVA_ONLINE_ANTICIPACION_MIN_SEGUNDOS`).
6. `TurnoRepository.existeSolapeProfesional` → 409 `eje: 'profesional'`.
7. `TurnoRepository.existeSolapeSillon` → 409 `eje: 'sillon'`.
8. `BloqueoRepository.existeBloqueoAplicable` → 409 `eje: 'bloqueo'`.
9. Insertar turno con `origen: 'online'` (TurnoRepository.crear).
10. Log sin PHI: `turno online creado id=<uuid>`.

## 4. Rate limiting público (`backend/src/agenda/publicRateLimiter.ts`)

Clase separada del `LoginRateLimiter` de C-03 (diferente ventana y clave):
- Clave: IP del cliente (`req.ip`).
- Ventana y máx. intentos configurables por variable de entorno (`RESERVA_ONLINE_RATE_MAX`, `RESERVA_ONLINE_RATE_WINDOW_SEGUNDOS`; por defecto 10 intentos / 60 s).
- Middleware Express que rechaza con `429` y header `Retry-After` cuando se excede.
- No loguea la IP (R3).

## 5. Configuración (`backend/src/shared/config.ts`)

Extender `loadConfig` con:
- `reservaOnline: { anticipacionMinSegundos: number; rateMax: number; rateWindowSeconds: number }`
- Valores por defecto desde `process.env` con `Number()` y fallbacks seguros (sin secretos).

## 6. Montaje en app (`backend/src/shared/app.ts`)

Agregar tras las rutas privadas:
```ts
app.use('/api/public', reservaOnlineRouter(db, config));
```
`reservaOnlineRouter(db, config)` recibe el `db` y la configuración completa (incluida `authConfig` por si se necesita validar algo, aunque no se use JWT).

## 7. Diseño de tests (`backend/tests/reserva_online.test.ts`)

SQLite real en memoria (R12: sin mock de transacción). Fixtures ficticios (R1/R12).

Escenarios Dado/Cuando/Entonces:
1. Dado profesional y sillón libres Cuando reserva online Entonces 201 con origen='online'
2. Dado turno activo del profesional Cuando reserva solapado Entonces 409 eje='profesional'
3. Dado turno activo en el sillón Cuando reserva solapado otro profesional Entonces 409 eje='sillon'
4. Dado bloqueo vigente Cuando reserva intersectado Entonces 409 eje='bloqueo'
5. Dado fin <= inicio Cuando reserva Entonces 400 y no persiste
6. Dado inicio dentro de ventana de anticipación Cuando reserva Entonces 400 eje='anticipacion'
7. Dado disponibilidad Cuando consulta Entonces devuelve huecos libres (no solapados ni bloqueados)
8. Dado sin anticipación mínima configurada Cuando reserva con inicio inmediato Entonces 201 (ventana 0)
9. Dado IP excede rate limit Cuando reserva Entonces 429

## 8. Decisiones de diseño

- **D1 (reuso de lógica de solape)**: No se duplica la consulta de intersección; se llama a `TurnoRepository.existeSolapeProfesional` / `existeSolapeSillon` ya probadas en C-04.
- **D2 (transacción inmediata)**: Toda la validación + inserción va en `UnitOfWork.runInTransaction` (`BEGIN IMMEDIATE`) para prevenir race conditions en reservas públicas concurrentes (R9).
- **D3 (sin PHI en errores públicos)**: Los cuerpos de error de endpoints públicos contienen solo `eje` e ids opacos; nunca nombres, teléfonos ni DNI (R3).
- **D4 (origen online)**: El turno creado tiene `origen = 'online'` (valor ya permitido en la migración 003 de C-04); no se añade migración nueva.
- **D5 (rate limiting separado)**: El rate limit de reservas públicas es independiente del de login de C-03 (distinta clave, ventana y propósito).
- **D6 (configuración por env)**: Anticipación mínima y rate limit se leen de variables de entorno con fallbacks en código (no hardcodeados de secretos).

## 9. Riesgos abiertos
- Valor exacto de anticipación mínima (2h ficticio): RN-06 lo califica como [Supuesto operativo]. Se deja configurable por env para ajustar sin redeploy.

---

¿Apruebo este diseño para proceder a **tasks**?

Responder: **Sí, continuar a tasks** / **No, ajustar design**.
