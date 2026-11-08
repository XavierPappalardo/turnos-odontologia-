# catalogo/precios Specification

## Purpose
Provee el catálogo de prestaciones odontológicas con precios base expresados estrictamente en moneda de curso legal (ARS en centavos enteros), con exposición pública para reserva online y administración interna autorizada bajo RBAC.

## Requirements

### Requirement: Integridad monetaria de precios en catálogo
El sistema SHALL almacenar el precio base de cada prestación odontológica en enteros centavos (`precio_base_centavos INTEGER NOT NULL DEFAULT 0 CHECK (precio_base_centavos >= 0)`) con moneda fija `ARS`, rechazando valores negativos y números con punto flotante para prevenir discrepancias de redondeo financiero.

#### Scenario: Creación o actualización con centavos enteros válidos
- **WHEN** se consulta o persiste una prestación con `precio_base_centavos = 2500000` (ARS 25.000,00)
- **THEN** el sistema conserva el valor exacto como entero de centavos sin redondeo ni aproximaciones en punto flotante

#### Scenario: Rechazo de precio base negativo
- **WHEN** se intenta actualizar una prestación con `precio_base_centavos` menor a cero
- **THEN** el sistema rechaza la operación con código `400` y mensaje de error de validación

### Requirement: Consulta pública del catálogo de prestaciones y tarifas
El sistema SHALL exponer el endpoint público `GET /api/public/prestaciones` sin requerir autenticación JWT, retornando la nómina de prestaciones activas con su duración, precio base en centavos y representación formateada para presentación en moneda nacional (`$ X.XXX,XX`).

#### Scenario: Paciente consulta catálogo público de precios
- **WHEN** un cliente o paciente envía una solicitud HTTP `GET /api/public/prestaciones`
- **THEN** el sistema responde `200 OK` con un arreglo de prestaciones activas, cada una incluyendo `id`, `codigo`, `nombre`, `duracion_min`, `precio_base_centavos` y `precio_formateado`

#### Scenario: Exclusión de prestaciones inactivas del catálogo público
- **WHEN** una prestación posee `activo = 0` y se invoca `GET /api/public/prestaciones`
- **THEN** dicha prestación no es incluida en la lista pública retornada

### Requirement: Consulta interna de prestaciones para personal de la clínica
El sistema SHALL exponer `GET /api/prestaciones` requiriendo token JWT vigente y autorizando a los roles `recepcion`, `profesional` y `administracion` para consultar el inventario completo de prestaciones y precios vigentes.

#### Scenario: Recepción consulta prestaciones para agendamiento interno
- **WHEN** un usuario con rol `recepcion` y token JWT válido solicita `GET /api/prestaciones`
- **THEN** el sistema responde `200 OK` con la lista de prestaciones y sus precios base en centavos

#### Scenario: Petición interna sin autenticación rechazada
- **WHEN** se envía `GET /api/prestaciones` sin encabezado `Authorization` ni cookie de sesión
- **THEN** el sistema responde `401 Unauthorized`

### Requirement: Actualización de precio base por administración
El sistema SHALL exponer `PUT /api/prestaciones/:id/precio` permitiendo únicamente al rol `administracion` modificar el `precio_base_centavos` de una prestación existente, actualizando la marca de tiempo `updated_at`.

#### Scenario: Administrador actualiza precio base de una prestación
- **WHEN** un usuario con rol `administracion` envía `PUT /api/prestaciones/:id/precio` con `{ "precio_base_centavos": 3000000 }`
- **THEN** el sistema actualiza la prestación, refresca `updated_at` y responde `200 OK` con la entidad actualizada

#### Scenario: Recepción o profesional intenta modificar precio y es denegado
- **WHEN** un usuario con rol `recepcion` o `profesional` intenta ejecutar `PUT /api/prestaciones/:id/precio`
- **THEN** el sistema rechaza la solicitud con `403 Forbidden` preservando inalterado el precio

#### Scenario: Modificación de prestación inexistente
- **WHEN** un administrador intenta actualizar el precio de un identificador de prestación inexistente
- **THEN** el sistema responde `404 Not Found`

### Requirement: Integración de catálogo de precios en reserva online
El sistema SHALL permitir que los flujos de disponibilidad y reserva online (`/api/public/turnos`) vinculen la prestación elegida garantizando que los datos de duración y precio de referencia correspondan al catálogo público activo.

#### Scenario: Reserva online valida prestación activa existente
- **WHEN** un paciente reserva un turno público enviando un `prestacion_id` válido y activo
- **THEN** el sistema registra el turno asociando la prestación y confirmando su coherencia temporal y de catálogo
