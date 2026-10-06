# 10 — Preguntas abiertas (todo lo "No evidenciado" del Discovery)

**Fecha**: 2026-10-06
**Fuente base**: `discovery/discovery.md` (2026-10-06), en especial §7–§11, Anexos A–D y §7.7. Sin datos reales.

## P1. Periodontograma

- **Estado**: No evidenciado. Confirmado como ausente en la página de funcionalidades de DentalSoft (https://dentalsoft.com.ar/funcionalidades — 2026-10-06); presente solo en Dentalink, DentalSaaS, Dentaly y Doctocliq según Anexo A.
- **Impacto en roadmap**: queda fuera del MVP (odontograma FDI mínimo sí entra); entra como ampliación clínica en fase 2 junto a ortodoncia/estética avanzada (discovery.md Anexo D). Si un segmento objetivo lo exige, adelanta clínica y retrasa caja/OS.

## P2. Facturación electrónica AFIP

- **Estado**: No evidenciado salvo declaración de OdontoClinIA y DentalTec/ARCA sin profundidad verificada (https://clinia.com.ar — 2026-10-06; https://web.dentaltec.com.ar/ — 2026-10-06; discovery.md §8 y Anexo A).
- **Impacto en roadmap**: excluida del MVP por costo y homologaciones (discovery.md §10); su inclusión en fase 2 exige homologación, certificados y pruebas con el Estado, y condiciona el módulo caja/OS.

## P3. Verificación PUCO

- **Estado**: No evidenciado salvo declaración de OdontoClinIA (https://clinia.com.ar — 2026-10-06; discovery.md §8 y Anexo A: "validar profundidad real", Anexo D).
- **Impacto en roadmap**: fase 2; sin PUCO el MVP solo registra cobertura declarada por plan. Requiere demo técnica a ClinIA antes de estimar (discovery.md Anexo D: producto prioritario para demo n.º 3).

## P4. API pública para desarrolladores

- **Estado**: No evidenciado en Argentina; solo declarada fuera (Ninsaúde API, SimplyBook API/Zapier) (https://ninsaude.com — 2026-10-06; https://simplybook.me/es — 2026-10-06; discovery.md §8).
- **Impacto en roadmap**: etapas posteriores (discovery.md Anexo D); no bloquea el MVP. Adelantarla desvía esfuerzo de agenda/caja hacia ecosistema.

## P5. Exportación de datos y auditoría

- **Estado**: Parcialmente evidenciado. Solo DentalSoft declara exportación dentro de los 30 días posteriores a la baja y disponibilidad del 99% (https://dentalsoft.com.ar/terminos — 2026-10-06); auditoría/validación solo en DentalTec como capa institucional (https://web.dentaltec.com.ar/ — 2026-10-06). Cifrado, backup y adecuación a Ley 26.529 / Ley 25.326 / HCE: No evidenciado (discovery.md §7.4 y §10).
- **Impacto en roadmap**: riesgo de lock-in y riesgo regulatorio (discovery.md §10 y Anexo C, vacío 4); el MVP debe incluir exportación básica y trazabilidad de caja desde el día 1 aunque ningún competidor local lo documente, y prever asesoría legal antes de fase 2.

## P6. Preferencia real online-vs-WhatsApp

- **Estado**: No evidenciado — supuesto sin probar (discovery.md §7: "no validado con usuarios reales"; §10 y §11, línea ~128).
- **Impacto en roadmap**: bloquea la inversión en portal del paciente y app propia; exige validación con usuarios antes de construir (discovery.md §10). Mientras tanto, MVP mixto: reserva online simple + confirmación/gestión por WhatsApp.

## P7. Costos exactos de WhatsApp en Argentina

- **Estado**: Parcialmente evidenciado. Referencia ≈ USD 0,026/mensaje declarado por DentalSoft (https://dentalsoft.com.ar/ — 2026-10-06, afirmación comercial); AgendaPro con WhatsApp pago aparte +$7.900 vía fuente secundaria (https://agendapro.com/ar — 2026-10-06; https://turnoapp.com.ar/blog/alternativa-a-agendapro — 2026-10-06); Fresha con 20 notificaciones SMS+WA gratis combinadas y luego ARS 180–375 (https://www.fresha.com/es/pricing — 2026-10-06). Costo exacto Meta/plantillas en ARS para este producto: No evidenciado.
- **Impacto en roadmap**: el pricing en ARS debe explicitar el traslado del costo variable (discovery.md §10); sin el número exacto no se puede cerrar margen por plan. Acción: cotizar BSP/Meta y fijar cupo por plan antes del lanzamiento.

## P8. Adopción real de competidores (cifras sin auditoría)

- **Estado**: Mayoría como afirmación comercial o No evidenciado. Ejemplos: Dentalink +15.000 clientes / 45M citas (https://www.softwaredentalink.com/ — 2026-10-06, afirmación comercial); DentalSoft 300+ clínicas y métricas +35% / 8 h / −82% sin metodología (https://dentalsoft.com.ar/ — 2026-10-06); DentalTec 2.000+ profesionales (https://web.dentaltec.com.ar/ — 2026-10-06); AgendaPro +30.000 negocios y Capterra 4,8/5 con 158 reseñas (https://www.capterra.com.ar/software/218709/agendapro — 2026-10-06); DentalSaaS, ClinIA, Dentaly, Órbita, OdontoApp con adopción No evidenciado (discovery.md Anexo A).
- **Impacto en roadmap**: no usar cifras rivales como metas ni como prueba de demanda; dimensionar el MVP por validación propia (demos a los 5 prioritarios del Anexo D, prueba con consultorios 1–10 profesionales) y no por "más funcionalidades".
