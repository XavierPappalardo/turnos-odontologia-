# Specs: C-06 confirmacion-cancelacion-reprogramacion

## Escenarios verificables

### Escenario 1: Confirmar turno válido
**Dado** un turno en estado `reservado` y un token de acción `confirmar` válido y no expirado
**Cuando** se envía `POST /api/public/turnos/:id/confirmar?token=...`
**Entonces** el sistema responde `200` con el turno en estado `confirmado`

### Escenario 2: Confirmar turno ya confirmado
**Dado** un turno en estado `confirmado` y un token de acción `confirmar` válido
**Cuando** se intenta confirmar de nuevo
**Entonces** el sistema responde `409` con `transicion_invalida`

### Escenario 3: Cancelar turno con anticipación
**Dado** un turno en estado `reservado` con inicio futuro (más allá de la ventana de anticipación mínima) y un token de acción `cancelar` válido
**Cuando** se envía `POST /api/public/turnos/:id/cancelar?token=...`
**Entonces** el sistema responde `200` con el turno en estado `cancelado`

### Escenario 4: Cancelar turno sin anticipación mínima (RN-06)
**Dado** un turno con inicio dentro de la ventana de anticipación mínima configurada y un token de acción `cancelar` válido
**Cuando** se intenta cancelar
**Entonces** el sistema responde `400` con `eje = 'anticipacion'`

### Escenario 5: Token expirado
**Dado** un token de acción cuya fecha de expiración ya pasó
**Cuando** se intenta cualquier acción (confirmar/cancelar/reprogramar)
**Entonces** el sistema responde `401`

### Escenario 6: Token inválido
**Dado** un token que no existe en la tabla `turno_token`
**Cuando** se intenta cualquier acción
**Entonces** el sistema responde `401`

### Escenario 7: Token ya usado
**Dado** un token de acción ya consumido (`usado_en` no nulo)
**Cuando** se intenta reusarlo
**Entonces** el sistema responde `403`

### Escenario 8: Token de otra acción
**Dado** un token de acción `cancelar` usado para intentar `confirmar`
**Cuando** se intenta confirmar
**Entonces** el sistema responde `401`

### Escenario 9: Reprogramar turno sin solape
**Dado** un turno en estado `reservado` y un token de acción `reprogramar` válido, con nuevo horario libre
**Cuando** se envía `POST /api/public/turnos/:id/reprogramar?token=...` con `nuevo_inicio` y `nuevo_fin`
**Entonces** el sistema responde `200`, el turno original queda en estado `cancelado` y se crea un nuevo turno con `estado = 'reservado'` y `origen = 'online'`

### Escenario 10: Reprogramar con solapamiento
**Dado** un intento de reprogramar con un nuevo horario que solapa con otro turno activo del mismo profesional o sillón
**Cuando** se intenta reprogramar
**Entonces** el sistema responde `409` con `eje = 'profesional'` o `eje = 'sillon'`

### Escenario 11: Turno inexistente
**Dado** un token válido para un turno que ya no existe
**Cuando** se intenta cualquier acción
**Entonces** el sistema responde `404`

### Escenario 12: Sin PHI en errores públicos
**Dado** un error 409 o 400 en endpoints públicos
**Cuando** se inspecciona el cuerpo de respuesta
**Entonces** contiene solo `eje` e ids opacos, sin nombres, teléfonos ni DNI

## Criterios de aceptación
- `POST /api/public/turnos/:id/confirmar` confirma un turno `reservado` con token válido
- `POST /api/public/turnos/:id/cancelar` cancela respetando anticipación mínima (RN-06)
- `POST /api/public/turnos/:id/reprogramar` reprograma sin crear solapamiento
- Tokens de un solo uso y con vencimiento configurable
- Errores sin PHI (solo `eje` + ids opacos)
- Tests Vitest Dado/Cuando/Entonces verdes con SQLite real en memoria (`tests/turno_token.test.ts`)
- `tsc --noEmit` limpio, sin `any` sin justificar
- Migración 006: tabla `turno_token` creada idempotentemente
