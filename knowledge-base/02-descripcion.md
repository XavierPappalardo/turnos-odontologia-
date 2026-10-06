# 02 — Descripción y alcance

**Fecha:** 2026-10-06
**Fuente base:** `discovery/discovery.md`, punto 5 (necesarias), punto 6 (opcionales) y Anexo D (MVP sugerido).

Reproduce la clasificación del Anexo D del Discovery, ajustada a las 7 decisiones aprobadas (segmento 1–10, AFIP/PUCO/ReNaPDiS en fase 2, WA API oficial con costo trasladado, stack Node.js + Express + SQLite + Vitest, portal paciente fase 2 temprana / white label tardío, supuesto online/WA sin validar, precios ARS publicados).

## Alcance MVP (imprescindible)

1. Agenda multi-profesional y por sillón/box con anti-solapamiento.
2. Reserva de turno online 24/7 (link, web, redes), sin registro friccionante.
3. Confirmación, cancelación y reprogramación por el paciente (WhatsApp / link).
4. Recordatorios automáticos por WhatsApp (API oficial; costo Meta ≈ USD 0,026 por mensaje trasladado; https://dentalsoft.com.ar/ — 2026-10-06) y/o e-mail.
5. Historia clínica + odontograma FDI.
6. Presupuestos y planes de tratamiento con seguimiento hasta el cobro.
7. Caja multimedio (efectivo, tarjeta, transferencia, Mercado Pago) + cierre diario + control de deudas.
8. Obras sociales argentinas: cobertura por plan aplicada al turno y liquidación de reintegros.
9. Liquidación de comisiones por profesional.
10. Roles y permisos (recepción, profesional, administración).
11. Reportes básicos: ocupación, facturación, ausentismo.
12. Precios públicos en ARS.

## Diferenciadores (post-MVP temprano)

1. IA / chatbot de WhatsApp que agenda 24/7 (diferenciador, no estándar; antecedentes: Órbita, Bewe, Soyla-Doctocliq, AI Contact Centre-Dentalink — 2026-10-06).
2. Portal del paciente (turnos, presupuestos, documentos) — fase 2 temprana por decisión aprobada (antecedente comprobado: DentalSoft plan Pro y DentalSaaS; https://dentalsoft.com.ar/funcionalidades — 2026-10-06).
3. Recuperación de pacientes inactivos y cobranza automática de deudas.
4. Solicitud automática de reseñas en Google.
5. Demo instantánea + migración desde Excel/papel y onboarding en <24 h (estándar de adopción; DentalSoft declara <24 h como afirmación comercial; https://dentalsoft.com.ar/ — 2026-10-06).

## Posteriores / tardíos

1. AFIP (facturación electrónica), verificación PUCO, receta ReNaPDiS — fase 2 por decisión aprobada (único declarante local: OdontoClinIA; profundidad "No evidenciada" — 2026-10-06).
2. Periodontograma y módulos de ortodoncia/estética avanzada (periodontograma en DentalSoft: No evidenciado; https://dentalsoft.com.ar/funcionalidades — 2026-10-06).
3. Recetas y consentimientos con firma digital (antecedentes: Dentaly, DentalSaaS, Ninsaúde Sign — 2026-10-06).
4. Inventario y órdenes de laboratorio/protésica (antecedente: Doctocliq — 2026-10-06).
5. Multi-sucursal con tablero consolidado.
6. White label — tardío por decisión aprobada (antecedentes: DentalSaaS, Ninsaúde — 2026-10-06).
7. API pública, sincronización bidireccional con Google Calendar, app móvil.
8. Página web de la clínica incluida.

## Fuera de alcance explícito del MVP

- Capa institucional (validación/auditoría estilo DentalTec): segundo producto, no sustituto del SaaS de consultorio (Discovery punto 4 — 2026-10-06).
- Marketplace de captación estilo AgendaPro/Fresha/Doctoralia: referencia de UX, no alcance MVP.
