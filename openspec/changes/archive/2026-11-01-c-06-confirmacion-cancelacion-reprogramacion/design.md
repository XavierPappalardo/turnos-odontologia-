# Design — C-06 confirmacion-cancelacion-reprogramacion

## Identificador
- Change: `C-06 confirmacion-cancelacion-reprogramacion`
- Fecha: 2026-11-01
- Estado: `diseñado` (pendiente de aprobación antes de tasks)

## 1. Modelo de datos: tabla `turno_token`

Nueva tabla para tokens de acción de un solo uso. Se añade **migración 006**:

```sql
CREATE TABLE IF NOT EXISTS turno_token (
  id TEXT PRIMARY KEY,
  turno_id TEXT NOT NULL REFERENCES turno(id),
  token_hash TEXT NOT NULL UNIQUE,      -- SHA-256 del token en claro (nunca se almacena el claro)
  accion TEXT NOT NULL CHECK (accion IN ('confirmar', 'cancelar', 'reprogramar')),
  expires_at TEXT NOT NULL,             -- ISO 8601 UTC
  usado_en TEXT,                        -- NULL = no usado; fecha de uso cuando se consume
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_turno_token_turno ON turno_token(turno_id);
CREATE INDEX IF NOT EXISTS idx_turno_token_valido ON turno_token(token_hash, usado_en, expires_at);
```

Razón: `hashToken` de C-03 (SHA-256) se reusa para no almacenar el token en claro. La tabla es nueva porque C-05 no la creó.

## 2. Arquitectura de endpoints públicos

| Endpoint | Método | Autenticación | Token de acción |
|----------|--------|---------------|-----------------|
| `POST /api/public/turnos/:id/confirmar` | POST | No | Requerido (`?token=...`) |
| `POST /api/public/turnos/:id/cancelar` | POST | No | Requerido (`?token=...`) |
| `POST /api/public/turnos/:id/reprogramar` | POST | No | Requerido (`?token=...`) + cuerpo `{nuevo_inicio, nuevo_fin}` |

Todos los endpoints públicos requieren el token de acción como query parameter. El token se valida antes de cualquier transición.

## 3. Diseño de rutas (`backend/src/agenda/turnoToken.routes.ts`)

Sigue el patrón de `reservaOnline.routes.ts` (C-05):
- Sin `requireAuth` ni `requireRoles`.
- Lee `token` de `req.query.token`.
- Respuesta `200` con `{id, estado}` sin PHI.
- Errores: `400` validación, `401` token inválido/expirado, `403` token ya usado, `404` turno inexistente, `409` transición inválida o solapamiento (reprogramar), `429` rate limit.
- Cuerpos sin PHI (solo ids opacos + `eje`).

Montaje en `app.ts`: `app.use('/api/public', turnoTokenRouter(db, config));` — se fusiona con el router público de C-05.

## 4. Servicio (`backend/src/agenda/turnoToken.service.ts`)

Interfaz de entrada:
```ts
export interface AccionTurnoInput {
  turnoId: string;
  accion: 'confirmar' | 'cancelar' | 'reprogramar';
  token: string;
  nuevoInicio?: string;   -- solo para reprogramar
  nuevoFin?: string;      -- solo para reprogramar
}
```

Flujo dentro de `UnitOfWork.runInTransaction` (`BEGIN IMMEDIATE`):

1. **Validar token**: buscar por `token_hash = SHA-256(token)`. Si no existe, expiró (`expires_at < ahora`) o ya se usó (`usado_en IS NOT NULL`) → error correspondiente (401/403).
2. **Validar que el token pertenece al turno y a la acción solicitada**: `turno_id` y `accion` deben coincidir.
3. **Validar existencia del turno**: `turnos.findById(turnoId)` → 404 si no existe.
4. **Validar transición de estado**: `puedeTransicionar(actual.estado, nuevoEstado)` según `TRANSICIONES` (C-04) → 409 `transicion_invalida` si no.
5. **Validación específica por acción**:
   - **confirmar**: `reservado → confirmado`. No hay más restricciones.
   - **cancelar**: `reservado|confirmado → cancelado`. Validar **RN-06 anticipación mínima**: `inicio - ahora >= anticipacionMinSegundos`. Si no, 400 `eje: 'anticipacion'`.
   - **reprogramar**: `reservado → cancelado` (marca el actual como cancelado) + crear turno nuevo con `origen = 'online'`, `nuevo_inicio`, `nuevo_fin`. Validar solape profesional/sillón/bloqueo del **nuevo** turno (reusa `TurnoRepository.existeSolapeProfesional/Sillon` + `BloqueoRepository.existeBloqueoAplicable`) → 409 `eje: 'profesional'/'sillon'/'bloqueo'`.
6. **Consumir token**: `usado_en = ahora` (marca como usado, uso único).
7. **Ejecutar transición**: `turnos.actualizarEstado(turnoId, estadoEsperado, estadoNuevo)` (CAS para concurrencia).
8. **Si es reprogramar**: insertar turno nuevo con `origen = 'online'`.
9. **Log sin PHI**: `turno ${accion} id=${turnoId} token consumido`.

## 5. Configuración (`backend/src/shared/config.ts`)

Extender `ReservaOnlineConfig` (ya existe de C-05) o agregar `turnoTokenConfig`:
- `turnoTokenTtlSeconds`: TTL del token de acción (default `7 * 24 * 60 * 60` = 7 días).
- Variable de entorno: `TURN_TOKEN_TTL_SECONDS`.

## 6. Montaje en app (`backend/src/shared/app.ts`)

Agregar tras las rutas de C-05:
```ts
app.use('/api/public', turnoTokenRouter(db, config));
```

## 7. Diseño de tests (`backend/tests/turno_token.test.ts`)

SQLite real en memoria (R12). Fixtures ficticios (R1/R12).

Escenarios Dado/Cuando/Entonces:
1. Dado turno `reservado` y token válido de confirmar Cuando confirma Entonces 200 estado `confirmado`
2. Dado turno ya `confirmado` y token de confirmar Cuando intenta confirmar Entonces 409 `transicion_invalida`
3. Dado turno `reservado` y token válido de cancelar con anticipación Cuando cancela Entonces 200 estado `cancelado`
4. Dado turno `confirmado` y token válido de cancelar con anticipación Cuando cancela Entonces 200 estado `cancelado`
5. Dado turno con inicio en menos de la ventana de anticipación Cuando intenta cancelar Entonces 400 `eje: 'anticipacion'`
6. Dado token expirado Cuando intenta cualquier acción Entonces 401
7. Dado token inválido (hash no encontrado) Cuando intenta cualquier acción Entonces 401
8. Dado token ya usado Cuando intenta reusarlo Entonces 403
9. Dado token de otra acción Cuando intenta confirmar con token de cancelar Entonces 401 (token no corresponde a la acción)
10. Dado turno `reservado` y token de reprogramar con nuevo turno sin solape Cuando reprograma Entonces 200, turno original `cancelado`, nuevo turno `reservado` con `origen='online'`
11. Dado reprogramar con nuevo turno que solapa profesional Cuando reprograma Entonces 409 `eje: 'profesional'`
12. Dado turno inexistente Cuando intenta cualquier acción Entonces 404
13. Dado cuerpo sin PHI Cuando hay error 409 Entonces respuesta solo tiene `eje` e ids opacos

## 8. Decisiones de diseño

- **D1 (token de un solo uso)**: `usado_en` se setea al consumir; cualquier reuso → 403. Evita ataques de repetición.
- **D2 (hash, no claro)**: El token en claro viaja por query param solo en el momento del clic del link (WhatsApp/email). Se almacena solo el SHA-256 (`hashToken` de C-03).
- **D3 (transacción inmediata)**: Validación + consumo de token + transición de estado en `UnitOfWork.runInTransaction` (`BEGIN IMMEDIATE`) para prevenir race conditions (R9).
- **D4 (uso de `actualizarEstado` CAS)**: Si otra escritura cambió el estado entre lectura y UPDATE → 409 concurrencia.
- **D5 (reprogramar = cancelar + crear)**: El turno original se marca `cancelado` (libera hueco) y se crea uno nuevo con `origen='online'` respetando solape/bloqueos de C-04/C-05.
- **D6 (sin PHI en errores públicos)**: Cuerpos de error solo con `eje` e ids opacos (R3).

## 9. Riesgos abiertos
- TTL del token (7 días ficticio): valor por defecto configurable por env para ajustar sin redeploy.
- El envío real del link por WhatsApp/email queda fuera de este change (C-07/C-17).

---

¿Apruebo este diseño para proceder a **tasks**?

Responder: **Sí, continuar a tasks** / **No, ajustar design**.
