# Proposal — c-04-agenda-turnos-overlaps

## Why

La doble reserva (mismo profesional o mismo sillón/box en el mismo horario) es el defecto operativo que invalida toda la agenda: genera choques en recepción, sobreturnos no autorizados y huecos mal liberados. Crear el turno con validación anti-solapamiento en tiempo de escritura es el núcleo del MVP (Sección D): pertenece a Sección D porque implementa la reserva interna verificable del flujo CU-3 con reglas RN-01/RN-02/RN-04 comprobables por test, y es acotada porque se limita a un único endpoint interno `POST /api/turnos` sin reserva online ni gestión posterior del ciclo de vida.

## What Changes

- Nuevo endpoint interno `POST /api/turnos` (uso recepción/administración vía auth C-03 [Supuesto]) que crea un turno en estado inicial `reservado`.
- Validación anti-solapamiento de doble eje AND (profesional + sillón/box) en tiempo de escritura con intervalo `[inicio, fin)` y filtro por estados activos (`reservado`, `confirmado`, `presente`).
- Lectura de tabla `Bloqueo` (solo lectura en este change): rechazo si el nuevo turno intersecta un bloqueo aplicable (por profesional, por sillón o global NULL/NULL).
- Validaciones de entrada: `fin > inicio`, FKs existentes ([Supuesto] tablas base de C-01/C-02), coherencia de zona horaria UTC ISO 8601.
- Máquina de estados mínima declarada (solo estados que ocupan vs. liberan agenda); sin endpoints de transición en este change.
- Errores tipificados: `400` validación, `403` RBAC/permiso ([Supuesto] roles C-03), `409` conflicto con eje indicado (`profesional` | `sillon` | `bloqueo`) y UUIDs opacos internos sin PHI.
- Migración 003 ([Supuesto] numeración sobre base C-01/C-02): índices `(profesional_id, inicio, fin)` y `(sillon_id, inicio, fin)`; CHECK `fin > inicio`.

Fuera de alcance (no se implementa en este change):
- Reserva online pública (C-05), confirmar/cancelar/reprogramar (C-06), CRUD de bloqueos (C-08).
- UI/pantallas, librerías/ORMs/frameworks adicionales, integraciones (WhatsApp, Mercado Pago).

## Capabilities

### New Capabilities
- `agenda/crear-turno`: creación interna de turno con validación anti-solapamiento por profesional y por sillón/box, validación contra bloqueos, estados mínimos y errores 400/403/409.

### Modified Capabilities
- (vacío — parte de cero, no hay specs previas que modificar)

## Impact

- Affected code: nuevo módulo `src/agenda|turnos` (servicio de creación + repositorio Turno + lector Bloqueo), migración 003, route `POST /api/turnos`. Sin impacto en frontend (no existe aún) ni en integraciones.
- APIs: un endpoint interno nuevo; contrato de error 409 con campo `eje`.
- Dependencies: requiere C-01 (scaffolding/migraciones), C-02 (modelos base) y C-03 (auth/RBAC/JWT) — ausentes al momento de planificar, por lo que sus contratos se toman como [Supuesto] y se documentan en design/specs.
