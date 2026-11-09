# Proposal

## Why

El MVP ya cubre agenda, reserva online y gestión por links/tokens (C-04/C-05/C-06/C-07), pero el Discovery identifica que el canal preferido real (online vs. WhatsApp) sigue sin validar (P-06, RN-11) y que WhatsApp es el canal operativo dominante para confirmaciones. C-16 incorpora el diferenciador D-01: un flujo conversacional por WhatsApp que permite agendar 24/7 reutilizando la lógica existente de disponibilidad y anti-solapamiento, reduciendo fricción de recepción sin introducir credenciales reales de proveedores en esta etapa.

## What Changes

- **Nuevo**: capacidad `notificaciones/chatbot-whatsapp-agenda` con contrato de comportamiento para un asistente conversacional de WhatsApp que agenda y gestiona turnos 24/7 (agendar, confirmar, cancelar, reprogramar) sobre la lógica vigente de agenda/solapes/bloqueos/anticipación.
- **Nuevo**: manejo de estado conversacional efímero/persistible mínimo (sesión por conversación) con expiración, reintentos controlados y respuestas deterministas ante errores/ambigüedad, sin exponer PHI.
- **Nuevo**: adaptador de integración WhatsApp en modo **estructura/simulación** (sin credenciales reales): recepción normalizada de mensajes entrantes (webhook simulado o endpoint interno de prueba) y salida de mensajes salientes a través de una interfaz desacoplada; el costo Meta (RN-10) se trata como restricción operativa documentada, no como facturación real.
- **Nuevo**: endpoints/servicios internos para orquestar intenciones (`agendar`, `confirmar`, `cancelar`, `reprogramar`) reutilizando servicios/repositorios existentes (disponibilidad pública, creación de turno con overlaps, acciones por token/estado) y aplicando rate limiting/anti-abuso.
- **Nuevo**: suite de tests Vitest (Dado/Cuando/Entonces) con datos ficticios y SQLite real donde aplique a reglas críticas (overlaps/transacciones), cubriendo flujos básicos de agenda vía chatbot, límites, errores y ausencia de PHI en logs/respuestas.
- **No incluido (non-goal de implementación en este change)**: credenciales reales WhatsApp Cloud API/BSP, envío real a Meta, NLP avanzado/LLM productivo, portal paciente (C-17), campañas (C-18/C-19), facturación electrónica o cambios en reglas de negocio de solapamiento/anticipación ya definidas.

## Capabilities

### New Capabilities

- `notificaciones/chatbot-whatsapp-agenda`: asistente conversacional por WhatsApp (estructura sin credenciales reales) para agendar, confirmar, cancelar y reprogramar turnos 24/7, con estado de conversación, validación de límites/errores y reutilización de la lógica de disponibilidad, anti-solapamiento, bloqueos y transiciones de turno existentes.

### Modified Capabilities

- _(ninguna — no se modifican requisitos normativos de specs existentes; el chatbot consume comportamientos ya especificados en `agenda/crear-turno`, reserva pública, acciones de turno y `notificaciones/recordatorios` sin cambiar sus contratos)._

## Impact

- **Backend (principal)**: nuevo módulo bajo `backend/src/notificaciones/` (o submódulo chatbot) con servicio de orquestación, máquina de estados conversacional, adaptador WhatsApp simulado, repositorio/persistencia mínima de sesión conversacional (migración nueva) y rutas internas/públicas de webhook simulado; extensión acotada de `shared/config.ts` para flags/configuración de chatbot/WhatsApp (sin secretos reales).
- **APIs**: endpoints para ingreso normalizado de mensajes (simulado) y, si aplica, consulta operativa de estado de conversación en entorno de prueba; respuestas JSON sin PHI, solo IDs opacos/códigos.
- **Dependencias/sistemas**: reutiliza SQLite, Express, Vitest y patrones existentes (rate limit público, UnitOfWork/BEGIN IMMEDIATE vía servicios de agenda, validaciones RN-01/RN-02/RN-04/RN-06, tokens/acciones C-06). No requiere proveedores externos reales ni nuevas dependencias obligatorias para MVP estructural; cualquier integración real futura queda detrás del adaptador.
- **Riesgos conocidos (a detallar en design/specs)**: ambigüedad conversacional, identidad de paciente sin auth fuerte, abuso/spam, costo WhatsApp (RN-10), y preferencia de canal no validada (RN-11/P-06). Se mitigan con límites, expiración de sesión, confirmaciones explícitas y datos ficticios en pruebas.
