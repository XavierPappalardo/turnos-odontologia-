# notificaciones/solicitud-resena Specification

## Purpose

Define la solicitud automática de reseñas post-atención mediante un link configurable, con disparo al atender turnos, entrega simulada, registro y deduplicación seguros.

## Requirements

### Requirement: Disparador post-atención para solicitud de reseña

El sistema SHALL evaluar la elegibilidad de solicitud de reseña cuando un turno alcanza el estado `atendido` mediante una transición válida. La evaluación SHALL ejecutarse de forma que no revierta la transición de estado ya confirmada y MUST respetar la configuración de habilitación.

#### Scenario: Turno atendido elegible genera evaluación
- **WHEN** un turno ficticio transiciona válidamente a estado `atendido` y la funcionalidad está habilitada
- **THEN** el sistema evalúa la solicitud de reseña para ese turno y registra el resultado correspondiente sin modificar el estado del turno

#### Scenario: Funcionalidad deshabilitada no genera solicitud
- **WHEN** un turno ficticio transiciona a `atendido` y la solicitud de reseñas está deshabilitada
- **THEN** el sistema no crea una solicitud enviada simulada y registra/retorna un resultado seguro de omisión según configuración

#### Scenario: Transición no atendida no dispara solicitud
- **WHEN** un turno ficticio transiciona a un estado distinto de `atendido`
- **THEN** el sistema no dispara la solicitud automática de reseña por ese cambio

### Requirement: Envío simulado de link de reseña

El sistema SHALL generar solicitudes con un link de reseña configurable y canal operativo declarado (WhatsApp o email como metadato), usando entrega simulada/estructural sin credenciales reales de Google, WhatsApp, email o proveedores externos. El contenido SHALL usar referencias seguras y MUST NOT incluir PHI.

#### Scenario: Solicitud elegible produce envío simulado
- **WHEN** la evaluación determina que un turno atendido ficticio es elegible y existe configuración válida
- **THEN** el sistema registra una solicitud con estado de envío simulado, canal declarado y referencia segura al link configurado, sin credenciales reales

#### Scenario: Configuración de link inválida se maneja con seguridad
- **WHEN** la evaluación se ejecuta con configuración de link ausente o inválida según reglas definidas
- **THEN** el sistema no realiza un envío simulado inválido y registra o responde con error/omisión tipada sin exponer datos sensibles

### Requirement: Registro y deduplicación de solicitudes

El sistema SHALL persistir solicitudes de reseña con estado observable (por ejemplo enviada simulada, omitida, fallida), identificadores opacos del turno/paciente objetivo y marcas temporales. SHALL aplicar deduplicación por turno y/o ventana configurable para evitar reenvíos indebidos.

#### Scenario: Solicitud duplicada por el mismo turno se omite
- **WHEN** ya existe una solicitud registrada para el mismo turno ficticio dentro de la regla de deduplicación vigente
- **THEN** el sistema omite el nuevo envío simulado y registra el motivo de omisión sin duplicar la solicitud efectiva

#### Scenario: Reintento fuera de regla no genera reenvío indebido
- **WHEN** se reevalúa una solicitud dentro de una ventana que impide reenvío
- **THEN** el sistema mantiene el control de duplicados y no genera un nuevo envío simulado indebido

### Requirement: Controles operativos, autorización y privacidad

El sistema SHALL exponer configuración validada para la funcionalidad de reseñas sin secretos reales. Las consultas operativas/administrativas de solicitudes SHALL estar restringidas a roles autorizados y MUST evitar PHI en logs, errores y respuestas.

#### Scenario: Usuario no autorizado consulta solicitudes
- **WHEN** un usuario sin rol autorizado intenta consultar registros de solicitudes de reseña
- **THEN** el sistema rechaza el acceso con error de autorización sin filtrar PHI

#### Scenario: Registros operativos no exponen PHI
- **WHEN** se listan o inspeccionan solicitudes, omisiones o errores
- **THEN** la salida contiene identificadores opacos y estados operativos seguros, sin nombres, DNI, teléfonos, datos clínicos ni secretos
