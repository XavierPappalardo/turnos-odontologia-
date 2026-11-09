# Spec Delta

## Purpose

Define la segmentación de pacientes inactivos y la cobranza automática por recordatorios de deuda, con reglas configurables, seguimiento de campañas/contactos y controles de privacidad e integración con caja.

## ADDED Requirements

### Requirement: Segmentación configurable de pacientes inactivos

El sistema SHALL identificar pacientes inactivos según reglas configurables basadas en actividad asistencial observable (por ejemplo, ausencia de atención/actividad relevante dentro de una ventana temporal). La segmentación SHALL excluir pacientes que no cumplan los criterios vigentes y MUST producir resultados aptos para operación interna sin exponer PHI en logs.

#### Scenario: Paciente supera la ventana de inactividad
- **WHEN** se ejecuta la segmentación con una ventana configurada y un paciente ficticio no registra actividad asistencial relevante dentro de esa ventana
- **THEN** el sistema incluye al paciente en el segmento de inactivos con identificadores opacos y metadatos operativos no sensibles

#### Scenario: Paciente con actividad reciente queda excluido
- **WHEN** se ejecuta la segmentación y un paciente ficticio tiene actividad asistencial relevante dentro de la ventana configurada
- **THEN** el sistema no incluye a ese paciente en el segmento de inactivos

#### Scenario: Reglas inválidas o ausentes usan control seguro
- **WHEN** se solicita segmentación con configuración inválida, incompleta o deshabilitada
- **THEN** el sistema rechaza o aplica el comportamiento seguro definido por configuración con error/respuesta tipada sin PHI

### Requirement: Campañas de recuperación para pacientes inactivos

El sistema SHALL permitir crear/ejecutar campañas de recuperación dirigidas a segmentos de inactivos, aplicando reglas y ventanas configurables (incluyendo límites de frecuencia/contacto cuando correspondan). Cada ejecución SHALL registrar seguimiento observable (estado, destinatarios/objetivos procesados en forma segura, resultado simulado) sin requerir credenciales reales de mensajería.

#### Scenario: Ejecución de campaña genera seguimiento simulado
- **WHEN** un usuario autorizado ejecuta una campaña de recuperación sobre un segmento con pacientes ficticios elegibles
- **THEN** el sistema registra la ejecución y el resultado de contacto simulado por objetivo elegible sin almacenar ni exponer PHI en logs

#### Scenario: Límite de contacto impide reenvío indebido
- **WHEN** un paciente ficticio ya recibió un contacto dentro de la ventana/frecuencia mínima configurada
- **THEN** el sistema omite o difiere el nuevo contacto según regla y lo refleja en el seguimiento sin duplicación indebida

### Requirement: Cobranza automática por deuda pendiente

El sistema SHALL generar recordatorios automáticos de cobranza para pacientes con deuda pendiente, derivada de la información de caja/deudas existente, según reglas y ventanas configurables. El cálculo/selección de deuda SHALL respetar la representación monetaria vigente (ARS en centavos en dominio/persistencia) y MUST NOT alterar saldos, pagos ni movimientos de caja.

#### Scenario: Paciente con deuda pendiente recibe recordatorio elegible
- **WHEN** se evalúa la cobranza automática y un paciente ficticio presenta deuda pendiente mayor a cero dentro de las reglas configuradas
- **THEN** el sistema genera un recordatorio de cobranza elegible con seguimiento simulado y referencia segura al contexto de deuda, sin modificar caja

#### Scenario: Paciente sin deuda pendiente no recibe recordatorio
- **WHEN** se evalúa la cobranza automática y un paciente ficticio no tiene deuda pendiente
- **THEN** el sistema no genera recordatorio de cobranza para ese paciente

#### Scenario: Ventana o límite impide cobranza duplicada
- **WHEN** un paciente ficticio con deuda pendiente ya fue contactado dentro de la ventana/frecuencia configurada
- **THEN** el sistema no envía un nuevo recordatorio indebido y registra el motivo de omisión/deferral de forma segura

### Requirement: Configuración y controles operativos de recuperación/cobranza

El sistema SHALL exponer configuración validada para activar/desactivar funcionalidades, definir ventanas/umbrales y límites operativos de recuperación y cobranza. La configuración SHALL rechazar valores inválidos con error tipado y MUST NOT requerir secretos reales de proveedores externos para el alcance de esta capacidad.

#### Scenario: Configuración válida se aplica
- **WHEN** se guarda o carga una configuración válida de inactividad, campañas y cobranza
- **THEN** el sistema aplica las reglas configuradas en las evaluaciones y ejecuciones posteriores

#### Scenario: Configuración inválida es rechazada
- **WHEN** se intenta usar una configuración con umbral, ventana o límite inválido
- **THEN** el sistema rechaza la operación/configuración inválida con error tipado sin exponer datos sensibles

### Requirement: Privacidad y autorización en recuperación/cobranza

Las operaciones de segmentación, campañas y cobranza SHALL estar restringidas a roles autorizados según el modelo vigente y MUST evitar PHI en logs, errores y respuestas externas. Los mensajes simulados/estructurales SHALL usar referencias seguras y contenido mínimo necesario.

#### Scenario: Usuario sin permiso intenta operar campañas o cobranza
- **WHEN** un usuario sin rol autorizado intenta consultar segmentos sensibles o ejecutar campañas/cobranza
- **THEN** el sistema rechaza la operación con error de autorización sin filtrar PHI

#### Scenario: Seguimiento y errores no exponen PHI
- **WHEN** una ejecución o validación falla durante segmentación, campaña o cobranza
- **THEN** los registros operativos y respuestas de error contienen códigos/identificadores opacos o contexto seguro, sin nombres, DNI, teléfonos ni datos clínicos