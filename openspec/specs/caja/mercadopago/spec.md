# caja/mercadopago Specification

## Purpose
Define la estructura de integración con Mercado Pago restringida al entorno de prueba (sandbox), aislada de la lógica de caja, sin credenciales reales ni secretos en el repositorio, con idempotencia, manejo de estados pendientes y errores, y lista para incorporar credenciales reales posteriormente (C-11, KB-04 §8, KB-08 §2.3).

## Requirements

### Requirement: Entorno sandbox obligatorio

El sistema SHALL operar la integración con Mercado Pago únicamente en modo `sandbox`: la configuración rechaza cualquier valor de entorno distinto a `sandbox` con un error de configuración explícito (fail-fast, sin defaults silenciosos), el adaptador solo usa credenciales de prueba y su única comunicación con el proveedor es la lectura de verificación documentada (`GET /v1/payments/{id}`), sin cobros reales.

#### Scenario: Configuración sin credenciales queda deshabilitada
- **WHEN** la aplicación arranca sin `MP_ACCESS_TOKEN` definido y se intenta registrar un cobro con medio `mercadopago`
- **THEN** el sistema responde `503` con código `mp_no_configurado`, ningún pago queda persistido y el registro de cobros por ese medio permanece bloqueado hasta que se configure la integración

#### Scenario: Entorno distinto de sandbox rechazado
- **WHEN** se define `MP_ENV=production` en la configuración
- **THEN** el arranque falla con un `ConfigError` que nombra la variable, sin exponer el valor del token

#### Scenario: Adaptador sandbox activo con credenciales de prueba
- **WHEN** se definen `MP_ENV=sandbox` y `MP_ACCESS_TOKEN` (valor de prueba) y se registra un cobro con medio `mercadopago`
- **THEN** el sistema responde `201`, persiste el pago en estado `pendiente` con referencia externa estructurada y no se efectúan cobros reales

### Requirement: Cobro Mercado Pago inicia pendiente

El sistema SHALL registrar todo cobro con medio `mercadopago` como pago `pendiente` con referencia interna trazable (id interno del pago + referencia estructurada de la preferencia), hasta que llegue confirmación de pago. El pago pendiente no computa en el total cobrado (`cobrado_ars`) del turno ni en la deuda, y sigue las mismas reglas de aplicación (a presupuesto `aceptado` o cobro directo por turno) que el resto de los medios.

#### Scenario: Registro de pago Mercado Pago en modo sandbox
- **WHEN** `recepcion` registra un cobro de 2000000 centavos con medio `mercadopago` con integración sandbox activa
- **THEN** el sistema responde `201`, el pago queda `pendiente` con referencia externa y el saldo restante del turno no cambia hasta que se confirme el pago

#### Scenario: Pago pendiente no computa en saldo
- **WHEN** un turno tiene un pago `pendiente` de 800000 y un concepto `aceptado` de 2000000, y se consulta el saldo
- **THEN** `cobrado_ars` es 0 y `saldo_restante` es 2000000

#### Scenario: Confirmación validada marca cobrado
- **WHEN** la transacción de Mercado Pago se confirma y `administracion` notifica la confirmación del pago pendiente por el canal interno de sandbox con firma válida del webhook y verificación directa en la API del proveedor aprobada con datos coincidentes (`external_reference`, importe, moneda `ARS`, estado `approved`)
- **THEN** el sistema responde `200`, el pago queda `cobrado` y se genera el movimiento de caja correspondiente

#### Scenario: Profesional no confirma pagos
- **WHEN** un `profesional` intenta confirmar un pago pendiente
- **THEN** el sistema responde `403` y el pago permanece `pendiente`

### Requirement: Notificación idempotente y operación repetida

El sistema SHALL procesar de forma idempotente las confirmaciones de pago pendiente: la confirmación repetida de un pago ya `cobrado` devuelve el mismo estado sin generar doble movimiento; la notificación sobre un pago `anulado` se rechaza sin cambio de estado.

#### Scenario: Confirmación repetida no duplica
- **WHEN** la confirmación del mismo pago `cobrado` se reenvía dos veces
- **THEN** la segunda respuesta es idempotente (`200` con el pago ya procesado) y `movimiento_caja` registra un único movimiento de cobro

#### Scenario: Notificación sobre pago anulado rechazada
- **WHEN** se intenta confirmar un pago que ya está `anulado`
- **THEN** el sistema responde `409` con código `mp_transicion_invalida` y el pago permanece `anulado`

### Requirement: Validación de firma del webhook de confirmación

El sistema SHALL validar la firma del webhook antes de leer datos: `x-signature`, `x-request-id` y `data.id` según la manifest de la documentación oficial de Mercado Pago (HMAC-SHA256 con el secreto configurado y comparación en tiempo constante; puede usarse el validador oficial compatible con el stack). Sin firma válida no se continúa: no se consulta al proveedor y ningún pago cambia de estado.

#### Scenario: Firma inválida rechazada sin consultar ni cambiar estado
- **WHEN** llega una notificación de confirmación cuya firma no valida (HMAC-SHA256 sobre `x-signature`, `x-request-id` y `data.id` con el secreto configurado)
- **THEN** el sistema responde `401` con código `mp_firma_invalida`, no consulta al proveedor, ningún pago cambia de estado y el intento queda registrado solo con el id interno y el tipo de error

#### Scenario: Notificación con firma válida sin pago local asociado
- **WHEN** la firma valida pero no existe ningún pago local vinculado a la referencia de la notificación
- **THEN** el sistema responde `404` con código `mp_pago_inexistente`, no se consulta al proveedor y no persiste cambio alguno

### Requirement: Consulta de verificación al proveedor y contraste

El sistema SHALL consultar el pago directamente a Mercado Pago tras validar la firma (GET `https://api.mercadopago.com/v1/payments/{id}`, `Authorization: Bearer <access token del servidor>`), contrastar la respuesta con el registro local — `external_reference` del pago esperado, `transaction_amount` exacto en centavos, `currency_id = ARS`, `status = approved` — y solo si todo coincide el pago pasa a `cobrado`; con cualquier fallo queda `pendiente` sin generar movimiento de caja.

#### Scenario: Pago aprobado y datos coincidentes acredita una sola vez
- **WHEN** la firma es válida y la consulta al proveedor informa `status = approved`, `transaction_amount` y `currency_id = ARS` coincidentes con el pago local, con `external_reference` vinculada a ese pago
- **THEN** el sistema responde `200`, el pago pasa a `cobrado` una sola vez (la verificación corre con el Bearer del servidor, no con datos del webhook) y se genera un único movimiento de caja

#### Scenario: Webhook con firma válida pero pago no aprobado en el proveedor
- **WHEN** la firma es válida y la consulta al proveedor informa `status` distinto de `approved` (p. ej. `pending`)
- **THEN** el sistema responde `422` con código `mp_pago_no_aprobado`, el pago permanece `pendiente` y no se genera ningún movimiento de caja

#### Scenario: Pago inexistente en la API del proveedor
- **WHEN** la firma es válida pero la consulta al proveedor no encuentra el pago
- **THEN** el sistema responde `422` con código `mp_pago_no_verificado`, el pago permanece `pendiente` y no se genera movimiento

#### Scenario: Importe, moneda o external_reference diferentes rechazados
- **WHEN** la respuesta del proveedor informa importe, moneda u `external_reference` distintos del registro local
- **THEN** el sistema responde `422` con código `mp_datos_incongruentes`, el pago permanece `pendiente` y no se genera movimiento

#### Scenario: Error o timeout al consultar la API deja el pago pendiente
- **WHEN** la consulta de verificación al proveedor falla por error o timeout
- **THEN** el sistema responde `502` con código `mp_error_proveedor`, el pago permanece `pendiente` y no se genera ningún movimiento de caja (un reenvío legítimo posterior puede confirmarlo)

### Requirement: Manejo de errores del proveedor sin exposición de secretos

El sistema SHALL tratar toda falla del adaptador de Mercado Pago (timeout, respuesta inválida, caída del proveedor) al crear la preferencia o al consultar el pago de verificación como error del proveedor: el pago queda `pendiente`, el error se registra en el log únicamente con el identificador interno del pago y el tipo de error, y la respuesta al usuario no expone tokens, secretos ni detalles internos del proveedor (R3).

#### Scenario: Error o timeout del proveedor deja pago pendiente
- **WHEN** el adaptador falla al comunicarse con Mercado Pago en modo sandbox, al registrar un cobro o al consultar el pago de verificación
- **THEN** el sistema responde `502` con código `mp_error_proveedor`, ningún dato del token aparece en la respuesta, el pago involucrado permanece `pendiente` y no se genera movimiento de caja

#### Scenario: Mensaje de error sin PHI ni secretos
- **WHEN** cualquier error de la integración se expone por el API
- **THEN** el mensaje contiene únicamente el tipo de error y el identificador interno, sin credenciales, secretos, ni datos de pacientes

### Requirement: Configuración documentada sin secretos

El sistema SHALL documentar las variables de la integración (`MP_ENV`, `MP_ACCESS_TOKEN` y las que derive el adaptador) en `backend/.env.example` con valores de ejemplo no secretos y comentarios sobre su papel, y SHALL NOT incluir tokens ni secretos reales en ningún archivo versionado (R15).

#### Scenario: Variables documentadas en el ejemplo de entorno
- **WHEN** un desarrollador lee `backend/.env.example` después de sincronizar este change
- **THEN** encuentra las variables de Mercado Pago comentadas con sus ejemplos no secretos y la indicación de modo sandbox

#### Scenario: Sin credenciales reales ni hook de secreto en repo
- **WHEN** se revisan los archivos versionados del cambio
- **THEN** no existe ningún token, secret ni credencial real almacenado; solo variables de ejemplo no secretas en `.env.example`
