# 01 — Visión del producto

**Fecha:** 2026-10-06
**Fuente base:** `discovery/discovery.md` (11 puntos + Anexos A–D, 18 sistemas, verificación de 5 fuentes el 2026-10-06) y `discovery/sources/` (18 notas).

## Qué producto

Sistema SaaS en la nube de gestión de turnos y administración para odontología en Argentina: agenda multi-profesional y por sillón/box, reserva online 24/7, confirmación y recordatorios por WhatsApp (API oficial), historia clínica con odontograma FDI, presupuestos y planes de tratamiento, caja multimedio con Mercado Pago, obras sociales argentinas con liquidación, comisiones por profesional y reportes de gestión.

**Decisiones aprobadas aplicadas:**

- Segmento: consultorios y clínicas de 1 a 10 profesionales; el profesional independiente se trata como caso degenerado (1 profesional, 1 sillón).
- AFIP / PUCO / ReNaPDiS quedan en fase 2 (no MVP).
- WhatsApp vía API oficial; costo Meta ≈ USD 0,026 por mensaje, trasladado al cliente (criterio observado en DentalSoft; https://dentalsoft.com.ar/ — 2026-10-06).
- Stack: Node.js + Express + SQLite + Vitest.
- Portal del paciente: diferenciador de fase 2 temprana; white label tardío.
- Supuesto sin validar: preferencia mixta online / WhatsApp; exige validación con usuarios reales.
- Precios publicados en ARS desde el inicio.

## Para quién

- Profesional independiente y equipos chicos (1–10 profesionales), con rol de recepción concentrado o dedicado.
- Clínicas que hoy coordinan por WhatsApp, teléfono o papel y liquidan obras sociales y comisiones en planillas paralelas.

## Por qué gana frente a DentalSoft y Dentalink

- Frente a DentalSoft (Argentina; planes ARS 0 / 30.000 / 60.000 por mes; 300+ clínicas como afirmación comercial; https://dentalsoft.com.ar/ — 2026-10-06): se compite con onboarding en menos de 24 horas, demo sin fricción, migración desde Excel/papel y un "todo-en-uno argentino" con precios ARS publicados desde el día 1 (vacío de mercado identificado en Anexo C del Discovery).
- Frente a Dentalink (Chile, plataforma regional; +15.000 clientes y 45M de citas/año como afirmación comercial sin auditoría; https://www.softwaredentalink.com/ — 2026-10-06): se compite por localización argentina real (obras sociales por plan, Mercado Pago, caja diaria en ARS) frente a cotización opaca y facturación electrónica no argentina (CO en Dentalink; https://www.softwaredentalink.com/ — 2026-10-06).
- Diferencial transversal declarado en el Discovery (Anexo C): ningún competidor local combina OS + Mercado Pago + AFIP + WhatsApp automático + precios ARS publicados (conclusión del relevamiento de 18 sistemas — 2026-10-06; "No evidenciado" para un competidor que ya lo combine).

## Lo que no promete este producto

- No incluye en el MVP facturación electrónica AFIP, verificación PUCO ni receta ReNaPDiS (fase 2 por costo y homologaciones; único antecedente local declarado: OdontoClinIA; "No evidenciado" en profundidad real — 2026-10-06).
- No declara cumplimiento de Ley 26.529, Ley 25.326 ni HCE: ningún competidor local lo documenta (Discovery punto 10 — 2026-10-06); requiere asesoría legal desde el día 1.
- Métricas de resultado (+35 % ocupación, 8 h/semana, −82 % ausencias en DentalSoft): afirmación comercial sin metodología publicada (https://dentalsoft.com.ar/ — 2026-10-06). Este producto no replica dichas cifras.
