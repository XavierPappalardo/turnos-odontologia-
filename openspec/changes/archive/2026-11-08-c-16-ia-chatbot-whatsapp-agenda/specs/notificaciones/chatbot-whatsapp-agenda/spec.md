# Spec Delta — notificaciones/chatbot-whatsapp-agenda

## Purpose

Define el comportamiento observable de un asistente conversacional por WhatsApp (estructura sin credenciales reales) que permite agendar y gestionar turnos 24/7 reutilizando las reglas vigentes de agenda, sin exponer datos sensibles.

## ADDED Requirements

### Requirement: Ingreso normalizado de mensajes conversacionales

El sistema SHALL aceptar mensajes entrantes de WhatsApp en forma normalizada (webhook simulado o endpoint interno de prueba) con un identificador opaco de conversación y texto/comando, sin requerir credenciales reales de Meta/BSP. La respuesta SHALL ser JSON con identificadores opacos y el mensaje saliente normalizado; no SHALL incluir PHI.

#### Scenario: Mensaje entrante válido genera respuesta normalizada

- **WHEN** se recibe un mensaje entrante con `conversation_id` opaco y texto de intención soportada
- **THEN** el sistema responde `200` con `conversation_id`, estado conversacional y un mensaje saliente normalizado, sin nombres, DNI, teléfonos ni datos clínicos

#### Scenario: Entrada inválida o incompleta se rechaza sin PHI

- **WHEN** se recibe un mensaje sin `conversation_id` o sin contenido interpretable
- **THEN** el sistema responde con error de validación (`4xx`) y un código/mensaje genérico sin PHI ni eco del contenido sensible

### Requirement: Estado conversacional con expiración y límites

El sistema SHALL mantener estado de conversación por `conversation_id` opaco para flujos multi-paso (agendar, confirmar, cancelar, reprogramar), con expiración configurable y límites de intentos/reintentos. Al expirar o exceder límites, SHALL reiniciar o rechazar el paso con orientación segura y sin PHI.

#### Scenario: Conversación multi-paso conserva contexto hasta completar

- **WHEN** un usuario inicia agendar y responde los pasos requeridos dentro del tiempo de sesión
- **THEN** el sistema conserva el contexto mínimo necesario entre mensajes y completa la intención cuando la información es suficiente y válida

#### Scenario: Sesión expirada obliga a reiniciar el flujo

- **WHEN** se recibe un mensaje para una conversación cuyo estado expiró
- **THEN** el sistema no ejecuta acciones pendientes con contexto vencido y responde indicando que debe reiniciarse el flujo, sin PHI

#### Scenario: Exceso de intentos inválidos limita el abuso

- **WHEN** una conversación supera el máximo configurado de intentos inválidos o mensajes en la ventana de control
- **THEN** el sistema rechaza o pausa el procesamiento según política configurada con respuesta genérica y registra solo identificadores opacos

### Requirement: Agenda de turno por conversación reutilizando disponibilidad y anti-solapamiento

Al confirmar una intención de agendar, el sistema SHALL crear el turno solo si pasa las validaciones vigentes de disponibilidad, anti-solapamiento por profesional y por sillón/box, bloqueos aplicables, duración/horario válidos y anticipación mínima configurada (RN-01/RN-02/RN-03/RN-04/RN-06). La operación SHALL usar la misma semántica transaccional de agenda para evitar solapes concurrentes.

#### Scenario: Agendamiento exitoso con slot disponible

- **WHEN** la conversación confirma agendar con profesional, recurso, paciente identificado de forma opaca/ficticia válida y horario disponible sin solape ni bloqueo
- **THEN** el sistema crea un turno válido según reglas existentes y responde confirmación con identificador opaco del turno

#### Scenario: Slot ocupado o bloqueado impide agendar

- **WHEN** la conversación intenta agendar en un horario con solape por profesional, solape por sillón/box o bloqueo aplicable
- **THEN** el sistema no crea el turno y responde conflicto/indisponibilidad con código y eje opaco, sin PHI

#### Scenario: Anticipación mínima no respetada impide agendar

- **WHEN** la conversación intenta agendar con menos anticipación que la mínima configurada
- **THEN** el sistema rechaza la creación con error de validación/negocio equivalente al flujo de reserva y sin PHI

### Requirement: Confirmación, cancelación y reprogramación por conversación

El sistema SHALL permitir confirmar, cancelar o reprogramar un turno identificado de forma opaca cuando la transición de estado es válida según la máquina de estados existente y se cumplen reglas de anticipación/cancelación. La reprogramación SHALL validar disponibilidad y anti-solapamiento del nuevo horario antes de persistir el cambio.

#### Scenario: Confirmación válida actualiza el estado del turno

- **WHEN** la conversación solicita confirmar un turno en estado que admite transición a confirmado
- **THEN** el sistema aplica la transición válida y responde éxito con el nuevo estado e identificador opaco

#### Scenario: Cancelación tardía o transición inválida se rechaza

- **WHEN** la conversación solicita cancelar o cambiar un turno fuera de anticipación permitida o con transición inválida
- **THEN** el sistema no modifica el turno y responde error con código opaco acorde a la regla incumplida

#### Scenario: Reprogramación valida el nuevo horario como nueva reserva

- **WHEN** la conversación solicita reprogramar a un nuevo horario
- **THEN** el sistema solo completa la reprogramación si el nuevo horario es válido, disponible y sin solape/bloqueo; en conflicto responde sin persistir el cambio parcial

### Requirement: Adaptador WhatsApp desacoplado sin credenciales reales

La integración con WhatsApp SHALL estar detrás de un adaptador/interfaz que permita operación en modo simulado o estructural sin credenciales reales. El sistema MUST NOT requerir secretos de Meta/BSP para ejecutar los flujos de prueba del chatbot; cualquier configuración de proveedor real futura SHALL inyectarse por entorno sin hardcodear secretos (R15).

#### Scenario: Ejecución de pruebas sin secretos externos

- **WHEN** se ejecutan los tests del chatbot en el entorno de CI/local con configuración de prueba
- **THEN** los flujos conversacionales básicos funcionan usando adaptador simulado y no realizan llamadas reales a proveedores externos

#### Scenario: Configuración ausente de proveedor real no rompe el modo simulado

- **WHEN** no existen credenciales reales de WhatsApp configuradas
- **THEN** el sistema mantiene operativos los endpoints/flujos simulados definidos para el change y reporta estado simulado sin exponer secretos

### Requirement: Observabilidad y privacidad conversacional

Los logs, errores y métricas operativas del chatbot SHALL registrar solo identificadores opacos (`conversation_id`, `turno_id` cuando aplique, tipo de intención, código de resultado) y MUST NOT registrar PHI, contenido clínico, números telefónicos reales en claro ni tokens/secretos. Los datos de pruebas y ejemplos SHALL ser ficticios (R1, R3).

#### Scenario: Error de orquestación no expone datos sensibles

- **WHEN** ocurre un error al procesar una intención (validación, conflicto, timeout de sesión)
- **THEN** la respuesta y el log operativo contienen códigos/IDs opacos y ningún dato personal o secreto

#### Scenario: Payload saliente no filtra identificadores clínicos

- **WHEN** el chatbot responde sobre un turno existente
- **THEN** el payload usa identificadores internos/opacos necesarios para la operación y omite PHI del paciente
