# Proposal

## Why

El sistema ya gestiona caja/deudas (C-11) y comunicaciones operativas, pero no aprovecha esos datos para recuperar pacientes inactivos ni automatizar recordatorios de deuda (D-03, CU-6/CU-8). C-18 agrega esta capacidad post-MVP para mejorar continuidad asistencial y cobranza, con controles de privacidad y configuración, sin depender de proveedores reales de mensajería.

## What Changes

- Segmentación configurable de pacientes **inactivos** (por ventana/regla definida sobre actividad asistencial observable en el sistema), con resultados acotados para operación interna.
- Definición y ejecución de **campañas de recuperación** para inactivos (selección de segmento, reglas/ventanas, registro de intentos/estado), con envío simulado/estructural coherente con patrones existentes (sin credenciales reales).
- **Cobranza automática** mediante recordatorios de deuda: detección de deuda pendiente del paciente basada en datos de caja/deudas (C-11), reglas/ventanas configurables, y registro/seguimiento de envíos sin duplicación descontrolada.
- Configuración de reglas y ventanas (umbrales de inactividad, frecuencia/límites de contacto, habilitación por tipo) con defaults seguros.
- Tests Vitest Dado/Cuando/Entonces (SQLite real en reglas críticas) para segmentación, generación/envío simulado y seguimiento.

## Capabilities

### New Capabilities
- `notificaciones/recuperacion-cobranza`: Segmentación de pacientes inactivos, campañas de recuperación y recordatorios automáticos de deuda pendientes, con reglas configurables, seguimiento e integración segura con caja/deudas.

### Modified Capabilities
- (none)

## Impact

- **Backend (nuevo dominio/módulo):** lógica y persistencia para segmentos/campañas/eventos de recuperación-cobranza (ruta/estructura a definir en `design.md`, alineada a patrones existentes).
- **Integración C-11:** lectura de deuda/saldo pendiente por paciente/concepto según contratos existentes de caja; no modifica reglas monetarias (ARS centavos/R5).
- **Notificaciones:** reutiliza enfoque simulado/estructural (sin credenciales reales) y restricciones R1/R3/R15.
- **Configuración/migraciones:** nuevos parámetros y tablas/índices incrementales para campañas, ejecuciones/contactos y configuración operativa.
- **APIs/UI:** endpoints internos/administrativos para consultar segmentos, configurar reglas y disparar/consultar campañas (alcance mínimo definido en specs/design); frontend opcional mínimo si el diseño lo requiere.
- **Governance:** BAJO (R16) — aun así requiere cuidado con PHI, límites de contacto y no exponer datos sensibles. Depende de C-15 (satisfecha).