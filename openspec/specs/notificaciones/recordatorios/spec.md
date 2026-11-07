# Spec — notificaciones/recordatorios

## Purpose

Programar, conservar y procesar los recordatorios automáticos T-48h/T-24h a lo largo del ciclo de vida del turno (creación, confirmación, reprogramación y cancelación), sin exponer datos clínicos.

## Requirements

### Requirement: Programación al crear un turno

Al persistirse un turno nuevo con inicio futuro, el sistema SHALL programar hasta dos
recordatorios en estado `pendiente` (hitos T-48h y T-24h) usando el canal predeterminado
configurado. La programación SHALL ocurrir después de confirmada la creación del turno y su
falla NO SHALL abortar ni revertir la creación.

#### Scenario: Dado un turno nuevo con inicio futuro, cuando se crea, entonces se programan dos recordatorios pendientes

- **WHEN** se crea un turno con inicio a más de 48 horas y canal predeterminado `whatsapp`
- **THEN** el turno queda persistido y existen exactamente dos recordatorios `pendiente` para ese turno, uno `recordatorio_48h` y uno `recordatorio_24h`, ambos con canal `whatsapp` y `programado_para` igual a inicio − 48 h e inicio − 24 h respectivamente

#### Scenario: Dado que la programación falla, cuando se crea el turno, entonces el turno persiste sin propagar el error

- **WHEN** la programación de recordatorios falla mientras se crea un turno
- **THEN** el turno queda creado en estado `reservado`, la respuesta de creación es exitosa y no se revierte ninguna escritura de agenda

### Requirement: Programación al confirmar un turno

Al pasar un turno de `reservado` a `confirmado`, el sistema SHALL garantizar que existan los
recordatorios futuros que falten, sin duplicar los ya programados.

#### Scenario: Dado un turno reservado sin recordatorios, cuando se confirma, entonces se programan los pendientes futuros

- **WHEN** se confirma un turno `reservado` con inicio a más de 48 horas y sin recordatorios
- **THEN** el turno pasa a `confirmado` y quedan dos recordatorios `pendiente` para ese turno

#### Scenario: Dado un turno con recordatorios ya programados, cuando se confirma, entonces no se duplican

- **WHEN** se confirma un turno `reservado` que ya tiene sus dos recordatorios programados
- **THEN** el turno pasa a `confirmado` y siguen existiendo exactamente dos recordatorios para ese turno

### Requirement: Hitos vencidos no se programan

El sistema SHALL omitir todo hito cuyo `programado_para` sea anterior o igual al instante de
programación; un turno demasiado próximo puede quedar con un solo recordatorio o con ninguno.

#### Scenario: Dado un turno con inicio dentro de una hora, cuando se crea, entonces no se programa ningún recordatorio

- **WHEN** se crea un turno cuyo inicio está a una hora
- **THEN** el turno se persiste y no se crea ningún recordatorio para él

#### Scenario: Dado un turno con inicio a 30 horas, cuando se crea, entonces sólo se programa el hito de 24 horas

- **WHEN** se crea un turno cuyo inicio está a 30 horas
- **THEN** existe un único recordatorio `recordatorio_24h` en estado `pendiente` y no existe `recordatorio_48h` para ese turno

### Requirement: Idempotencia por turno y tipo

El sistema SHALL mantener a lo sumo un recordatorio por combinación de turno y tipo, sin
importar cuántas veces se invoque la programación ni la secuencia crear, confirmar y
reintentar.

#### Scenario: Dado un turno creado y luego confirmado, cuando se vuelve a programar, entonces siguen existiendo dos recordatorios

- **WHEN** se crea un turno, se lo confirma y se invoca nuevamente la programación para el mismo turno e inicio
- **THEN** la tabla `recordatorio` contiene exactamente dos filas para ese turno, una por cada tipo

### Requirement: Reprogramación mueve los recordatorios

Al reprogramarse un turno, el sistema SHALL cancelar los recordatorios `pendiente` del turno
anterior y programar los hitos correspondientes al nuevo inicio sobre el turno nuevo.

#### Scenario: Dado un turno con pendientes, cuando se reprograma a una fecha futura, entonces los viejos se cancelan y los nuevos se programan

- **WHEN** se reprograma un turno con recordatorios pendientes a un nuevo inicio a más de 48 horas
- **THEN** los recordatorios del turno anterior quedan `cancelado`, el turno nuevo queda `reservado` y tiene dos recordatorios `pendiente` calculados desde el nuevo inicio

#### Scenario: Dado un turno con pendientes, cuando se reprograma a menos de 24 horas, entonces no se programan nuevos hitos

- **WHEN** se reprograma un turno con recordatorios pendientes a un nuevo inicio a una hora
- **THEN** los recordatorios del turno anterior quedan `cancelado` y el turno nuevo no tiene recordatorios

### Requirement: Cancelación al salir de la agenda

Cuando un turno pasa a `cancelado` o `ausente`, el sistema SHALL marcar como `cancelado`
todos sus recordatorios `pendiente`; los que ya están `enviado` no cambian de estado.

#### Scenario: Dado un turno con pendientes, cuando se cancela o se marca ausente, entonces sus pendientes quedan cancelados

- **WHEN** un turno con dos recordatorios `pendiente` pasa a `cancelado` o a `ausente`
- **THEN** ambos recordatorios quedan en estado `cancelado` y no se envían después

### Requirement: Procesamiento de recordatorios vencidos

El procesamiento SHALL marcar como `enviado` únicamente los recordatorios `pendiente` cuyo
`programado_para` sea anterior o igual al instante actual, registrando `enviado_en`. No SHALL
procesar recordatorios futuros, ya enviados ni cancelados.

#### Scenario: Dado un pendiente vencido, cuando se procesa, entonces se marca enviado

- **WHEN** se procesan recordatorios y existe un `pendiente` cuyo `programado_para` ya pasó
- **THEN** ese recordatorio queda `enviado` con `enviado_en` no nulo

#### Scenario: Dado un pendiente futuro, cuando se procesa, entonces sigue pendiente

- **WHEN** se procesan recordatorios y existe un `pendiente` cuyo `programado_para` es futuro
- **THEN** el recordatorio permanece `pendiente` y `enviado_en` sigue nulo

#### Scenario: Dado un recordatorio ya enviado, cuando se procesa, entonces no se reprocesa

- **WHEN** se procesan recordatorios y existe uno en estado `enviado`
- **THEN** ese recordatorio no se incluye en el resultado y conserva su `enviado_en` original

#### Scenario: Dado el endpoint público de procesamiento, cuando se invoca, entonces sólo procesa pendientes vencidos

- **WHEN** se invoca `POST /api/public/recordatorios/procesar` con un pendiente vencido, uno futuro y uno ya enviado
- **THEN** responde `200` con un único procesado (el vencido) y los otros dos conservan su estado previo

### Requirement: Sin PHI en logs y errores

Los logs operativos, los cuerpos de error y las respuestas de recordatorios SHALL contener
únicamente identificadores opacos (`turno_id`, `recordatorio_id`, tipo y estado); nunca
nombres, DNI, teléfonos ni números de historia clínica.

#### Scenario: Dado un fallo de programación, cuando se registra el error, entonces el log sólo tiene ids opacos

- **WHEN** falla la programación de recordatorios de un turno
- **THEN** el log incluye el `turno_id` y un código de error, y no incluye datos del paciente ni el mensaje crudo de la excepción

#### Scenario: Dado un error en el procesamiento público, cuando se inspecciona la respuesta, entonces no hay PHI

- **WHEN** el endpoint público de recordatorios devuelve un error
- **THEN** el cuerpo sólo contiene un código de error e identificadores opacos
