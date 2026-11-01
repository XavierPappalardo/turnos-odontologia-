# Specs: C-05 reserva-online

## Escenarios verificables

### Escenario 1: Reserva online exitosa
**Dado** profesional y sillón libres en una fecha futura (respetando anticipación mínima)
**Cuando** se envía `POST /api/public/turnos` sin autenticación con `origen` implícito `online`
**Entonces** el sistema responde `201` con el turno en estado `reservado` y `origen = 'online'`

### Escenario 2: Solape por profesional
**Dado** un turno activo del mismo profesional en el intervalo
**Cuando** se intenta crear otro turno superpuesto
**Entonces** el sistema responde `409` con `eje = 'profesional'` y no persiste el turno

### Escenario 3: Solape por sillón
**Dado** un turno activo en el mismo sillón con otro profesional
**Cuando** se intenta crear un turno superpuesto en ese sillón
**Entonces** el sistema responde `409` con `eje = 'sillon'` y no persiste el turno

### Escenario 4: Bloqueo aplicable
**Dado** un bloqueo vigente aplicable al profesional o sillón
**Cuando** se intenta crear un turno intersectado
**Entonces** el sistema responde `409` con `eje = 'bloqueo'` y no persiste el turno

### Escenario 5: Validación de entrada
**Dado** `fin <= inicio` o campos obligatorios faltantes
**Cuando** se envía `POST /api/public/turnos`
**Entonces** el sistema responde `400` y no persiste el turno

### Escenario 6: Anticipación mínima (RN-06)
**Dado** un `inicio` dentro de la ventana de anticipación mínima configurada
**Cuando** se intenta reservar
**Entonces** el sistema responde `400` con `eje = 'anticipacion'`

### Escenario 7: Disponibilidad pública
**Dado** fecha, profesional y sillón
**Cuando** se consulta `GET /api/public/agenda/disponibilidad`
**Entonces** devuelve solo huecos libres (sin solape ni bloqueos)

### Escenario 8: Rate limiting público
**Dado** una IP que excede el límite de intentos configurado
**Cuando** intenta reservar
**Entonces** el sistema responde `429` con header `Retry-After`

### Escenario 9: Concurrencia
**Dado** un hueco libre
**Cuando** dos solicitudes concurrentes intentan crear el mismo turno
**Entonces** una recibe `201` y la otra `409`; persiste un único turno activo

### Escenario 10: Sin PHI en errores públicos
**Dado** un error 409 por solape
**Cuando** se inspecciona el cuerpo de respuesta
**Entonces** contiene solo `eje` e ids opacos, sin nombres, teléfonos ni DNI

## Criterios de aceptación
- `GET /api/public/agenda/disponibilidad` responde horarios libres respetando solape y bloqueos
- `POST /api/public/turnos` crea turno `reservado` con `origen = 'online'` sin autenticación
- Anticipación mínima (RN-06) aplicable y configurable por variable de entorno
- Rate limiting por IP en endpoints públicos
- Tests Vitest Dado/Cuando/Entonces verdes con SQLite real en memoria (`tests/reserva_online.test.ts`)
- `tsc --noEmit` limpio, sin `any` sin justificar
