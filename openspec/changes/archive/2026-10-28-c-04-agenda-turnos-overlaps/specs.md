# Specs: C-04 agenda-turnos-overlaps

## Escenarios verificables (obligatorios)

### Escenario 1: Creación válida
**Dado** un profesional y sillón libres, sin bloqueo aplicable
**Cuando** recepción crea un turno con `fin > inicio`
**Entonces** responde `201` con estado `reservado` y se persiste

### Escenario 2: Solapamiento por profesional
**Dado** un turno activo del mismo profesional
**Cuando** se crea otro turno que intersecta su intervalo
**Entonces** responde `409 {eje:"profesional"}` y no persiste

### Escenario 3: Solapamiento por sillón/box
**Dado** un turno activo en el mismo sillón (aunque sea otro profesional)
**Cuando** se crea otro turno que intersecta
**Entonces** responde `409 {eje:"sillon"}` y no persiste

### Escenario 4: Contigüidad
**Dado** un turno de 10:00 a 10:30
**Cuando** se crea otro de 10:30 a 11:00 en el mismo profesional/sillón
**Entonces** responde `201` (intervalo semiabierto)

### Escenario 5: Bloqueo
**Dado** un bloqueo aplicable (profesional, sillón o global)
**Cuando** se intenta crear un turno que lo intersecta
**Entonces** responde `409 {eje:"bloqueo"}`

### Escenario 6: Estados que liberan agenda
**Dado** un turno `cancelado`, `ausente` o `atendido` en un hueco
**Cuando** se crea un turno nuevo en el mismo hueco
**Entonces** responde `201` porque esos estados no bloquean

### Escenario 7: Concurrencia
**Dado** dos requests concurrentes sobre el mismo hueco
**Cuando** ambas intentan crear el turno
**Entonces** una recibe `201` y la otra `409`; persiste un único turno activo

### Escenario 8: Máquina de estados
**Dado** un turno existente
**Cuando** se aplica una transición de KB-04 §9
**Entonces** se persiste (`reservado → confirmado → presente → atendido`; `reservado|confirmado → cancelado`; `confirmado → ausente`)

### Escenario 9: Transición inválida / rol no autorizado
**Dado** un turno en estado terminal o un usuario `profesional`
**Cuando** se intenta una transición inválida o un `PATCH`
**Entonces** responde `409` (estado sin cambio) o `403` respectivamente

## Criterios de aceptación
- Consulta de intersección con estados activos `reservado`, `confirmado`, `presente`
- `BEGIN IMMEDIATE` en toda escritura de turnos (R9)
- Errores sin PHI, solo ids opacos + `eje`/`desde`/`hacia`
- Tests `Dado/Cuando/Entonces` sobre SQLite real (R11/R12)
