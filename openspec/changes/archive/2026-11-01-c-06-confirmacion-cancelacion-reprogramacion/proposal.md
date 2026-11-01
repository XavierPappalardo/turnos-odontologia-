# Proposal — C-06 confirmacion-cancelacion-reprogramacion

## Identificador
- Change: `C-06 confirmacion-cancelacion-reprogramacion`
- Fecha propuesta: 2026-11-01
- Estado: `propuesta` (pendiente de aprobación antes de design)

## Contexto y dependencias
- Depende de: `C-05 reserva-online` (archivado ✓). Reutiliza `TurnoRepository` (estados activos, `actualizarEstado`), `turnoEstado.service.ts` (máquina de estados `TRANSICIONES`, `puedeTransicionar`, `cambiarEstadoTurno`), `UnitOfWork` (`BEGIN IMMEDIATE`), config de C-05 (`config.reservaOnline`).
- Gobierno: ALTO (endpoints públicos con tokens de acción: superficie de suplantación si el token es predecible; se mitiga con tokens aleatorios y vencimiento corto).
- En camino crítico: sí (C-01 → C-02 → C-03 → C-04 → C-05 → **C-06** → C-07 → C-14).

## Problema que resuelve
Permitir a un paciente confirmar, cancelar o reprogramar un turno mediante un link de acción recibido por WhatsApp/email, sin necesidad de autenticación JWT, respetando la máquina de estados de C-04 y la anticipación mínima de cancelación (RN-06).

## Alcance (scope)
1. **Tokens de acción** (`turno_token` o similar):
   - Generación de token aleatorio + hash para almacenamiento (nunca el token en claro, reusa `hashToken` de C-03).
   - Vencimiento corto configurable (por defecto 7 días, variable de entorno).
   - Asociación a un turno y a una acción permitida (`confirmar`, `cancelar`, `reprogramar`).
   - Uso único (se invalida tras consumirse).
2. **Endpoints públicos** bajo `/api/public/turnos/:id`:
   - `POST /api/public/turnos/:id/confirmar` → transiciona `reservado → confirmado`.
   - `POST /api/public/turnos/:id/cancelar` → transiciona `reservado|confirmado → cancelado` (valida anticipación mínima RN-06).
   - `POST /api/public/turnos/:id/reprogramar` → recibe `nuevo_inicio` y `nuevo_fin`; cancela el turno actual y crea uno nuevo con `origen = 'online'` si no hay solape (reusa lógica de C-05).
3. **Validaciones**:
   - Token válido, no expirado, no usado, pertenece al turno y a la acción.
   - Transición de estado válida según `TRANSICIONES` (C-04).
   - Anticipación mínima para cancelación (RN-06): el turno no puede cancelarse si falta menos de X horas para su inicio.
   - Al reprogramar: validar solape profesional/sillón/bloqueo (C-04/C-05) antes de crear el nuevo turno.
4. **Respuestas sin PHI** (R3): solo ids opacos + `eje` en errores; cuerpos de éxito sin datos del paciente.
5. **Tests Vitest** (Dado/Cuando/Entonces):
   - confirmar válido, cancelar válido, reprogramar válido
   - token expirado / inválido / ya usado → 401/403
   - transición inválida → 409
   - cancelación sin anticipación mínima → 400 `eje: 'anticipacion'`
   - reprogramación con solapamiento → 409 `eje: 'profesional'` / `sillon`

## Fuera de scope (C-06)
- Envío real de WhatsApp (queda para C-07 recordatorios; aquí solo se genera el token y se expone el endpoint).
- Autenticación del paciente (queda para C-17 portal-paciente).
- Modelo de tabla de tokens: se define en C-06 (nueva tabla `turno_token` con migración 006).

## Criterios de aceptación
- [ ] `POST /api/public/turnos/:id/confirmar` confirma un turno `reservado` con token válido
- [ ] `POST /api/public/turnos/:id/cancelar` cancela respetando anticipación mínima (RN-06)
- [ ] `POST /api/public/turnos/:id/reprogramar` reprograma sin crear solapamiento
- [ ] Tokens de un solo uso y con vencimiento
- [ ] Errores sin PHI (solo `eje` + ids opacos)
- [ ] Tests Vitest Dado/Cuando/Entonces verdes con SQLite real en memoria

## Leer antes
- `knowledge-base/06-features.md` F-03
- `knowledge-base/07-flujos.md` CU-2
- `knowledge-base/05-reglas-negocio.md` §RN-06
- `knowledge-base/04-modelos-datos.md` §9 (estados)

---

¿Apruebo este proposal para proceder al diseño (design.md)?

Responder: **Sí, continuar a design** / **No, ajustar proposal**.
