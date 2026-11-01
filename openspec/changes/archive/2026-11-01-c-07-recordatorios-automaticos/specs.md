# Specs: C-07 recordatorios-automaticos

## Escenarios verificables

### Escenario 1: Programar recordatorios para turno confirmado
**Dado** un turno en estado `confirmado` con inicio en el futuro
**Cuando** se llama a `programarRecordatoriosParaTurno`
**Entonces** se crean 2 recordatorios con estado `pendiente` (tipo `recordatorio_48h` y `recordatorio_24h`)

### Escenario 2: Turno con inicio muy cercano
**Dado** un turno con inicio dentro de menos de 48h y 24h
**Cuando** se programa recordatorios
**Entonces** no se crea ningún recordatorio (fecha programada ya pasó)

### Escenario 3: No duplicar recordatorios
**Dado** un turno con recordatorios ya programados
**Cuando** se llama a programar dos veces
**Entonces** no se crean duplicados (mismo turno_id y tipo)

### Escenario 4: Procesar recordatorios vencidos
**Dado** recordatorios con estado `pendiente` y `programado_para` en el pasado
**Cuando** se llama a `procesarRecordatoriosPendientes`
**Entonces** se marcan como `enviado` con `enviado_en` seteado

### Escenario 5: Recordatorio ya enviado
**Dado** un recordatorio con estado `enviado`
**Cuando** se procesan recordatorios pendientes
**Entonces** no se reprocesa (sigue como `enviado`)

### Escenario 6: Recordatorio con fecha futura
**Dado** un recordatorio con `programado_para` en el futuro
**Cuando** se procesan recordatorios pendientes
**Entonces** no se procesa (sigue como `pendiente`)

### Escenario 7: Cancelar recordatorios al cambiar estado de turno
**Dado** un turno con recordatorios pendientes
**Cuando** el turno cambia a `cancelado` o `ausente` (vía C-06/C-04)
**Entonces** los recordatorios pendientes se marcan como `cancelado`

### Escenario 8: Endpoint GET /api/public/recordatorios/pendientes
**Dado** recordatorios con estado `pendiente`
**Cuando** se llama al endpoint
**Entonces** responde `200` con la lista de recordatorios pendientes

### Escenario 9: Endpoint POST /api/public/recordatorios/procesar
**Dado** recordatorios vencidos
**Cuando** se llama al endpoint
**Entonces** responde `200` con la lista de recordatorios procesados (estado `enviado`)

### Escenario 10: Rate limiting público
**Dado** una IP que excede el límite de intentos configurado
**Cuando** llama a `/procesar` o `/pendientes`
**Entonces** responde `429` con header `Retry-After`

### Escenario 11: Sin PHI en errores públicos
**Dado** un error en endpoints públicos de recordatorios
**Cuando** se inspecciona el cuerpo de respuesta
**Entonces** contiene solo ids opacos, sin nombres, teléfonos ni DNI

## Criterios de aceptación
- Migración 007: tabla `recordatorio` creada idempotentemente con índices `(estado, programado_para)` y `(turno_id, tipo)`
- Worker `procesarRecordatoriosPendientes` procesa recordatorios vencidos y los marca como enviados
- No se reprocesan recordatorios ya enviados
- Los recordatorios se cancelan cuando el turno cambia a `cancelado` o `ausente`
- Rate limiting en endpoints públicos (reuso de C-05)
- Tests Vitest Dado/Cuando/Entonces verdes con SQLite real en memoria (`tests/recordatorio.test.ts`)
- `tsc --noEmit` limpio, sin `any` sin justificar
