# Spec Delta — agenda/crear-turno

## MODIFIED Requirements

### Requirement: Validación contra bloqueos

El sistema SHALL rechazar con `409` y `eje = "bloqueo"` todo turno que intersecte un bloqueo aplicable (mismo `profesional_id` o NULL global; mismo `sillon_id` o NULL global) con la misma fórmula de intersección. Solo SHALL considerarse bloqueos con `deleted_at IS NULL`: un bloqueo dado de baja lógicamente no bloquea reservas.

#### Scenario: Reserva sobre bloqueo vigente rechazada

- **WHEN** existe un bloqueo aplicable al profesional (o sillón, o global) de 10:00 a 12:00 y se intenta crear un turno intersectado de 11:00 a 11:30
- **THEN** el sistema responde `409` con `eje = "bloqueo"` y no persiste el turno

#### Scenario: Bloqueo dado de baja no impide reservar

- **WHEN** existe un bloqueo aplicable de 10:00 a 12:00 con `deleted_at` no nulo y se intenta crear un turno de 11:00 a 11:30
- **THEN** el sistema responde `201` con el turno en estado `reservado`
