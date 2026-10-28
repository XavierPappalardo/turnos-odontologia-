# Design: C-04 agenda-turnos-overlaps

## Anti-solapamiento
Consulta intersección: `inicio < nuevo_fin AND fin > nuevo_inicio`.
Estados activos: `reservado`, `confirmado`, `presente`.
Liberan: `cancelado`, `ausente`, `atendido`.
Índices: `(profesional_id, inicio, fin)` y `(sillon_id, inicio, fin)`.

## Concurrencia
`BEGIN IMMEDIATE` envuelve validaciones + inserción para prevenir race conditions
(una escritura gana, la otra recibe `409`).

## Bloqueos
Validar contra `bloqueo` aplicable (`profesional_id`/`sillon_id` NULL = global).

## Máquina de estados (KB-04 §9)
`reservado → confirmado → presente → atendido`
`reservado|confirmado → cancelado`
`confirmado → ausente`
- `PATCH /api/turnos/:id/estado`, solo `recepcion`/`administracion`.
- Update condicional (CAS por estado esperado) para evitar carreras.
- Transición inválida `409 {error:"transicion_invalida", desde, hacia}`;
  estado desconocido `400`; turno inexistente `404`; rol no autorizado `403`.
- Al cancelar/ausente/atendido el hueco se libera para nuevas reservas.

## Auth
Depende de C-03: JWT Bearer + matriz RBAC; errores sin PHI (R3).
