# 09 — Decisiones aprobadas

**Fecha**: 2026-10-06
**Fuente base**: `discovery/discovery.md` (2026-10-06) y notas en `discovery/sources/` (18 notas, 2026-10-06).
**Convención**: cada decisión cita sección/línea de discovery.md, competidor que la respalda (URL + 2026-10-06 o "No evidenciado") y qué se excluye. Sin datos reales.

## D1. Segmento: consultorios / clínicas de 1–10 profesionales

- **Decisión**: el MVP apunta a consultorios y clínicas pequeñas de 1–10 profesionales, no a redes/DSO ni al profesional aislado sin sillones compartidos.
- **Justificación trazable**: el estándar de mercado exige agenda multi-profesional diaria/semanal (discovery.md Anexo C) y el MVP sugerido pide agenda multi-profesional/por sillón (discovery.md Anexo D, línea ~195); el rango de precios local de referencia va de ARS 13.900 a 60.000/mes para 1 profesional (discovery.md §9).
- **Competidor que la respalda**: DentalSoft — gestión integral local con agenda multi-profesional y planes ARS 0 / 30.000 / 60.000 (https://dentalsoft.com.ar/ — 2026-10-06). Referencia secundaria: AgendaPro multiagenda (https://agendapro.com/ar — 2026-10-06).
- **Qué se excluye**: multi-sucursal con dashboard consolidado, capa institucional prestador–institución y white label para franquicias (discovery.md §6; https://web.dentaltec.com.ar/ — 2026-10-06; https://ninsaude.com — 2026-10-06).

## D2. AFIP / PUCO / ReNaPDiS en fase 2

- **Decisión**: facturación electrónica AFIP, verificación PUCO y recetario ReNaPDiS quedan fuera del MVP y pasan a fase 2.
- **Justificación trazable**: implican homologaciones y dependencias del Estado e incluirlas retrasa el lanzamiento (discovery.md §10, riesgo de alcance; §8: "quedan fuera del MVP sugerido"); el MVP sugerido las lista en etapas posteriores (discovery.md Anexo D, línea ~195).
- **Competidor que la respalda**: OdontoClinIA, único con PUCO/AFIP/ReNaPDiS 248 declarado en Argentina, con profundidad real aún por validar (https://clinia.com.ar — 2026-10-06; discovery.md Anexo D). Contrapeso: DentalSoft resuelve caja/OS/comisiones sin AFIP/PUCO (https://dentalsoft.com.ar/ — 2026-10-06).
- **Qué se excluye del MVP**: factura electrónica, validación contra padrón PUCO, receta electrónica ReNaPDiS ID 248, RENAPER y plan SUMAR+ (discovery.md §8).

## D3. WhatsApp por API oficial con costo trasladado

- **Decisión**: automatización sobre WhatsApp API oficial; el costo variable por mensaje se traslada explícitamente al cliente.
- **Justificación trazable**: WhatsApp es el canal dominante y el pricing debe absorber o trasladar el costo (discovery.md §9 y §10, riesgo de costos).
- **Competidor que la respalda**: DentalSoft, que declara costo Meta ≈ USD 0,026/mensaje y planes con WhatsApp diferenciado (https://dentalsoft.com.ar/ — 2026-10-06, afirmación comercial). Referencia de pricing desagregado: AgendaPro con WhatsApp pago aparte +$7.900 (https://agendapro.com/ar — 2026-10-06; verificado vía tercero https://turnoapp.com.ar/blog/alternativa-a-agendapro — 2026-10-06; https://www.capterra.com.ar/software/218709/agendapro — 2026-10-06).
- **Qué se excluye**: integración liviana manual asistida como única vía, envío gratuito ilimitado y chatbot IA 24/7 pleno en el MVP (esto último como diferenciador posterior, discovery.md §6).

## D4. Stack Node.js + Express + SQLite + Vitest

- **Decisión**: monolito modular con Node.js + Express + SQLite y tests en Vitest.
- **Justificación trazable**: restricción de stack aprobada por el usuario; coherente con onboarding en <24 h, demo sin fricción y simplicidad operativa para el segmento chico (discovery.md §9). Sin evidencia de stack exigido por competidores (No evidenciado a nivel implementación en discovery.md).
- **Competidor que la respalda**: ninguno a nivel stack (No evidenciado — los competidores no publican stack). A nivel alcance, DentalSaaS y Dentaly validan que un SaaS nube simple compite en el segmento chico (https://dental.delriotech.com.ar/ — 2026-10-06; https://dentaly.com.ar — 2026-10-06).
- **Qué se excluye**: microservicios, app móvil nativa, API pública y multi-sucursal en el MVP (discovery.md §6 y Anexo D).

## D5. Portal del paciente en fase 2; white label tardío

- **Decisión**: el portal del paciente va en fase 2 y el white label más tarde aún.
- **Justificación trazable**: el portal figura como opcional/diferenciador, no imprescindible, y el white label aparece en etapas posteriores (discovery.md §6 y Anexo D, línea ~195); además la preferencia online-vs-WhatsApp está sin validar (discovery.md §7 y §10).
- **Competidor que la respalda**: DentalSoft con portal del paciente en plan Pro y DentalSaaS con portal instalable + white label (https://dentalsoft.com.ar/funcionalidades — 2026-10-06; https://dental.delriotech.com.ar/ — 2026-10-06). Referencia de marca propia: Ninsaúde white label franquicias (https://ninsaude.com — 2026-10-06).
- **Qué se excluye del MVP**: turnos/presupuestos/documentos autogestionados por el paciente y personalización de marca por clínica.

## D6. Supuesto mixto online / WhatsApp sin validar

- **Decisión**: se asume —sin validar— que coexistirán reserva online y gestión por WhatsApp; debe validarse con usuarios reales antes de invertir en portal/app propios.
- **Justificación trazable**: supuesto sin probar declarado en discovery.md §7 ("que los pacientes argentinos prefieran reservar online antes que escribir por WhatsApp — no validado") y riesgo de preferencia real online-vs-WhatsApp (discovery.md §10); pregunta abierta §11 (línea ~128).
- **Competidor que la respalda**: patrón mixto observado en DentalSoft (online 24/7 + WhatsApp + chatbot Pro) y Dentalink (online + redes con confirmación WA/mail/tel) (https://dentalsoft.com.ar/ — 2026-10-06; https://www.softwaredentalink.com/ — 2026-10-06).
- **Qué se excluye**: decidir de forma definitiva un canal único; construir portal/app propios sin validación previa.

## D7. Precios en ARS publicados desde el inicio

- **Decisión**: modelo comercial con precios públicos en ARS desde el lanzamiento.
- **Justificación trazable**: el MVP sugerido incluye "precios públicos en ARS" como imprescindible y el pricing transparente figura como diferenciador frente a la cotización opaca (discovery.md Anexo D, línea ~195; Anexo C).
- **Competidor que la respalda**: DentalSoft ARS 0 / 30.000 / 60.000, Dentaly ARS 35.000/mes, DenPro ARS 19.900 / 29.900 (https://dentalsoft.com.ar/ — 2026-10-06; https://dentaly.com.ar — 2026-10-06; https://denpro.ar — 2026-10-06). Contrapeso opaco: Dentalink y Ninsaúde por cotización (https://www.softwaredentalink.com/ — 2026-10-06; https://ninsaude.com — 2026-10-06).
- **Qué se excluye**: cotización a pedido como única vía y precios solo en USD/EUR sin localización.
