# Discovery — Sistema de gestión de turnos odontológicos (Argentina / LatAm)

**Fecha**: 2026-10-06
**Modo**: research de mercado (sin Q&A al usuario; consignas del usuario como spec)
**Fuentes investigadas**: 18 sistemas (8 de Argentina, 6 de LatAm/España, 4 internacionales de referencia). Notas crudas en `discovery/sources/`.
**Convención**: toda afirmación factual lleva su fuente con URL y fecha de consulta (2026-10-06). Lo no verificable públicamente se consigna como "No evidenciado". Se distingue **funcionalidad comprobada** (visible en sitio oficial, documentación, pricing o centro de ayuda) de **afirmación comercial** (declarada por el proveedor sin evidencia verificable en esta pasada).

## 1. Problema que resuelve

Los consultorios y clínicas odontológicas de Argentina coordinan turnos por WhatsApp, teléfono o papel, lo que genera dobles reservas, ausentismo sin recupero y horas semanales de trabajo administrativo. La oferta local relevada confirma el diagnóstico: DentalSoft lo formula como "clínica en modo caos" (turnos perdidos, agenda que solo entiende una persona, obras sociales en planillas) y cuantifica +35 % de ocupación y 8 h/semana ahorradas como afirmación comercial (https://dentalsoft.com.ar/ — 2026-10-06). Dentalink, el líder regional, ataca el mismo problema con agenda + recordatorios + reagendamiento, declarando +15.000 clientes y 45M de citas/año (https://www.softwaredentalink.com/ — 2026-10-06, afirmación comercial sin auditoría).
El problema específico argentino tiene una segunda capa que casi ningún jugador resuelve completa: obras sociales/prepagas, nomenclador, Mercado Pago y facturación electrónica conviven con la agenda, y hoy se gestionan en planillas paralelas (DentalSoft y DentalSaaS lo documentan como dolor; https://dental.delriotech.com.ar/ — 2026-10-06).

## 2. Usuarios / roles

- **Paciente**: reserva online 24/7, confirma/cancela/reprograma por WhatsApp o link, paga (online o en consultorio), accede a su historial/presupuestos (portal del paciente en DentalSoft-plan Pro y DentalSaaS; app del paciente en Cenident/SMILE de referencia LatAm).
- **Recepción/administración**: gestiona agenda multi-profesional, confirma asistencias, cobra y cierra caja, liquida obras sociales y comisiones.
- **Odontólogo**: ve su agenda del día, registra historia clínica y odontograma, arma presupuestos y planes de tratamiento, receta.
- **Dueño/gestor de clínica o red**: mira ocupación, facturación, rentabilidad por tratamiento/profesional y ausentismo (dashboards en DentalSoft, Dentalink, Doctocliq, Ninsaúde).
- **Institución (círculo/colegio)**: valida prácticas, audita y liquida a prestadores (rol cubierto solo por DentalTec; https://web.dentaltec.com.ar/ — 2026-10-06).

## 3. Casos de uso

1. Como paciente, quiero reservar un turno online (profesional, fecha, horario) sin llamar ni escribir, a cualquier hora.
2. Como paciente, quiero confirmar, cancelar o reprogramar mi turno desde WhatsApp o un link.
3. Como recepcionista, quiero ver la agenda diaria/semanal de todos los profesionales y sillones, con bloqueos, sobreturnos y sin solapamientos.
4. Como recepcionista, quiero que los recordatorios y confirmaciones salgan solos y la agenda se actualice con la respuesta del paciente.
5. Como odontólogo, quiero registrar historia clínica, odontograma, plan de tratamiento y recetas en una sola ficha.
6. Como administración, quiero cobrar (efectivo, tarjeta, transferencia, Mercado Pago, obra social), cerrar caja y perseguir deudas automáticamente.
7. Como administración, quiero liquidar comisiones por profesional y reintegros de obras sociales sin planillas.
8. Como dueño, quiero ver ocupación, facturación, rentabilidad y ausentismo en un tablero, y recuperar pacientes inactivos con campañas.
9. Como paciente, quiero ver mis turnos, presupuestos y documentos en un portal propio.
10. Como institución, quiero validar y auditar prácticas de prestadores en tiempo real (caso DentalTec).

## 4. Competidores / soluciones existentes

Se relevaron 18 sistemas (ver **Anexo A** con la tabla comparativa completa y **Anexo B** con la matriz de puntuación). Resumen por relevancia para Argentina:

| Competidor | Origen | Problema que resuelve | Pricing observado | Diferenciadores |
|---|---|---|---|---|
| DentalSoft | Argentina | Gestión integral local (agenda, clínica, OS, caja) | ARS 0 / 30.000 / 60.000 por mes | Liquidaciones OS + comisiones; web + chatbot en plan Pro; demo instantánea |
| OdontoClinIA | Argentina | Agenda por sillón + interoperabilidad pública | No evidenciado | PUCO, AFIP, ReNaPDiS 248, SUMAR+; reagendamiento automático |
| Dentalink | Chile | Plataforma regional todo-en-uno + IA | Cotización | Escala (+15.000 clientes declarado); módulos financieros; IA integrada |
| DentalSaaS | Argentina | Clínica + OS/nomenclador + portal paciente | No evidenciado (3 planes) | White label; portal instalable; todo ilimitado |
| AgendaPro | Chile | Agenda genérica + marketplace | ARS 13.900–314.900 + WA aparte | Marketplace; app con marca; marketing/retención |
| Dentaly | Argentina | Simplicidad para 1 profesional | ARS 35.000/mes | Precio publicado; firma digital incluida |
| DenPro | Argentina | Entrada barata para independientes | ARS 19.900 / 29.900 | Prueba 30 días; simplicidad |
| Doctocliq | Perú | Todo-en-uno + laboratorio + IA WhatsApp | Plan gratis + 7 días trial | Plan free permanente; Soyla IA; lab/inventario |
| DentalTec | Argentina | Validación/auditoría institucional | No evidenciado | Red prestador–institución; −64 % débitos (afirmación) |
| Órbita | Argentina | Gestión + Chat IA modular | No evidenciado | Módulos separables; IA argentina |
| Ninsaúde | Brasil | Plataforma para clínicas y franquicias | Cotización | White label franquicias; dictado por IA; ecosistema |
| Doctoralia | España | Captación (directorio + opiniones + reserva) | ES €89–129; AR no publicado | Efecto red; reserva desde Google; Noa Notes |
| OdontoApp | Argentina | Agenda + HC básica (etapa temprana) | Página existe, monto no relevado | Foco local simple |
| Fresha (ref. UX) | Reino Unido | Reservas + marketplace belleza/salud | ARS 8.000 / 5.300 por miembro | Sin comisión por reserva; HIPAA/ISO; pricing localizado |
| SimplyBook (ref. UX) | Chipre/UK | Motor de reservas modular | Freemium, montos no relevados | 60+ funciones; SOAP/intake; sync calendarios |
| Bewe (ref. UX) | Colombia/MX | IA conversacional 24/7 | USD 29/mes | "El sistema trabaja solo" |
| tab32 (ref. UX) | EE. UU. | PMS dental cloud + IA | USD 125→225/mes | Pricing público; IA clínica y de seguros |
| Dentrix (ref. UX) | EE. UU. | Estándar DSO on-premise/cloud | Cotización | Profundidad clínica; ecosistema |

**Notas**: DentalTec es complemento (capa institucional), no sustituto de un SaaS de consultorio. Fresha, SimplyBook, Bewe, tab32 y Dentrix son referencias de UX/precio/IA, no competidores directos (sin odontología argentina salvo tab32/Dentrix en lo clínico).

## 5. Funcionalidades necesarias

- Reserva de turno online 24/7 (link, web, redes) sin registro obligatorio friccionante.
- Agenda diaria/semanal multi-profesional y por sillón/box, con duración variable, bloqueos, sobreturnos y prevención de solapamientos.
- Confirmación, cancelación y reprogramación por el paciente (WhatsApp/link).
- Recordatorios automáticos por WhatsApp/e-mail con actualización sola de la agenda.
- Historia clínica + odontograma FDI con estados e historial por pieza.
- Presupuestos y planes de tratamiento con seguimiento hasta el cobro.
- Caja, cobros multimedio (incl. Mercado Pago), cierre diario y control de deudas.
- Obras sociales argentinas: cobertura por plan aplicada al turno y liquidación de reintegros.
- Liquidación de comisiones por profesional.
- Roles y permisos (recepción, profesional, administración).
- Reportes básicos: ocupación, facturación, ausentismo.

## 6. Funcionalidades opcionales

- Chatbot/IA de WhatsApp que agenda 24/7 (diferenciador, no estándar).
- Portal del paciente (turnos, presupuestos, documentos).
- Recuperación de inactivos, campañas y solicitud automática de reseñas Google.
- Periodontograma, módulos de ortodoncia/estética, galería antes/después.
- Recetas y consentimientos con firma digital.
- Inventario y órdenes de laboratorio/protésica.
- Multi-sucursal con dashboard consolidado; white label.
- Facturación electrónica AFIP, verificación PUCO, receta ReNaPDiS (fase posterior salvo decisión contraria — ver punto 11).
- API pública, Google Calendar bidireccional, app móvil.
- Página web de la clínica incluida.

## 7. Reglas de negocio

- Un profesional/sillón no puede tener dos turnos superpuestos (anti-solapamiento; DentalSoft declara detección automática de solapamiento en sobreturnos — funcionalidad comprobada a nivel de oferta).
- Anticipación mínima configurable para reserva/cancelación (práctica estándar; valores exactos: No evidenciado por proveedor).
- La cobertura de obra social se calcula por tratamiento y plan al momento del turno (DentalSoft, comprobado en oferta).
- Comisiones por profesional: porcentaje general o por tratamiento, con vista previa antes de confirmar (DentalSoft, comprobado en oferta).
- Cierre de caja diario con trazabilidad de egresos y anulaciones (DentalSoft, comprobado en oferta).
- **Supuesto sin probar**: que los pacientes argentinos prefieran reservar online antes que escribir por WhatsApp por costumbre — no validado con usuarios reales (riesgo, ver punto 10).

## 8. Integraciones

- Probadas en el mercado local: WhatsApp (recordatorios y bots; costo Meta ≈ USD 0,026/mensaje declarado por DentalSoft), MercadoPago (cobros y señas), Google Calendar (sincronización por profesional), sitio web propio con turnos.
- Probadas solo fuera de Argentina: facturación electrónica (CO en Dentalink; PE/MX/EC/CO en Doctocliq), pagos online/financiamiento, firma electrónica (Ninsaúde Sign), API para desarrolladores (Ninsaúde), Xero/Meta Pixel/Analytics (Fresha), Zapier/Zoom/Outlook (SimplyBook).
- Declaradas únicamente en Argentina por ClinIA (máximo nivel de integración pública local): API de PUCO, facturación AFIP, recetario ReNaPDiS ID 248 (HL7 FHIR), RENAPER, plan SUMAR+.
- Decisión consciente: AFIP/PUCO y API pública quedan fuera del MVP sugerido (ver Anexo D), por costo y dependencia de homologaciones.

## 9. Restricciones

- Mercado argentino: precios en ARS, inflación y sensibilidad al precio (el rango relevado va de ARS 13.900 a 60.000/mes para 1 profesional; WhatsApp suma costo variable por mensaje).
- WhatsApp es el canal dominante: cualquier automatización debe operar sobre WhatsApp (API oficial con costo) o e-mail gratuito.
- Datos de salud sensibles: hosting, cifrado, backup, control de acceso y consentimientos deben diseñarse desde el día 1 aunque ningún competidor local los documente (ver punto 10).
- Adopción: el consultorio chico necesita onboarding en <24 h, demo sin fricción y migración desde Excel/papel (DentalSoft promete <24 h; Doctocliq ofrece prueba guiada).
- Alcance del Discovery: montos de AgendaPro AR citados vía tercero (turnoapp, verificación 2026-09-19); páginas SPA (OdontoApp) y sitios escuetos (Órbita) limitaron la verificación — todo lo no verificable quedó como "No evidenciado".

## 10. Riesgos

- **Supuesto sin probar**: preferencia real por reserva online vs. WhatsApp por costumbre — exige validación con usuarios antes de invertir en portal/app propios.
- **Riesgo**: si el profesional no mantiene disponibilidad actualizada, la agenda muestra huecos falsos (mitigación: reglas de bloqueo y confirmación).
- **Riesgo regulatorio**: ningún competidor local declara adecuación a Ley 26.529 (derechos del paciente/HC), Ley 25.326 (datos personales) ni Ley de HCE; construir sin asesoría legal expone a responsabilidad por datos sensibles.
- **Riesgo de costos**: WhatsApp API oficial traslada costo por mensaje (Meta ≈ USD 0,026); el pricing debe absorberlo o trasladarlo explícitamente como hace DentalSoft.
- **Riesgo competitivo**: DentalSoft y Dentalink tienen ventaja de base instalada y marca; competir solo por "más funcionalidades" no alcanza — el diferencial debe estar en IA conversacional, localización fiscal (AFIP/OS) o precio/experiencia.
- **Riesgo de alcance**: AFIP/PUCO/ReNaPDiS implican homologaciones y dependencias del Estado; incluirlas en el MVP retrasa el lanzamiento.

## 11. Preguntas abiertas

- ¿El MVP apunta al odontólogo independiente, a la clínica, o a ambos desde el día 1? (Define multi-sillón y pricing por profesional.)
- ¿Facturación AFIP y verificación PUCO van en el MVP o en fase 2?
- ¿WhatsApp vía API oficial (costo por mensaje, automatización total) o integración liviana (envío manual asistido)?
- ¿Presupuesto y restricción de stack/plataforma para el MVP?
- ¿Portal del paciente y white label entran al roadmap temprano o tardío?
- ¿Se valida con usuarios reales la preferencia online-vs-WhatsApp antes de construir?
- ¿El modelo comercial publica precios en ARS desde el inicio (como DentalSoft/Dentaly) o cotiza (como Dentalink/Ninsaúde)?

---

## Anexo A — Tabla comparativa (18 sistemas, ordenados por relevancia para Argentina)

| # | Sistema | País | Web | Segmento | Modalidad | Agenda | Turnos digitales | Automatización | Clínica | Admin/cobros | Integraciones locales | Seguridad declarada | Pricing | Adopción evidenciada |
|---|---------|------|-----|----------|-----------|--------|------------------|----------------|---------|--------------|----------------------|---------------------|---------|----------------------|
| 1 | DentalSoft | AR | dentalsoft.com.ar | Consultorio/clínica | SaaS nube | Semanal/diaria/mensual, multi-prof., bloqueos, sobreturnos c/detección, GCal | Online 24/7, WA, chatbot IA (Pro) | Recordatorios auto, cobranza deudas, reactivación, reseñas (Pro) | HC, odontograma 18 estados FDI, ortodoncia, consentimientos, recetas | Caja, MercadoPago, OS + liquidaciones, comisiones, reportes | WA, MercadoPago, GCal, web propia | "Nube segura"; privacidad/eliminación | ARS 0 / 30.000 / 60.000 | 300+ clínicas (afirm.); 3 testimonios |
| 2 | OdontoClinIA | AR | clinia.com.ar | Consultorio/clínica/cadena/público | Web SaaS | Por profesional/especialidad/sillón; reagend. auto | Recordatorios WA; IA WA 24/7 | Recordatorios + reagend. auto + IA | HCE (ley declarada); planes por etapas | PUCO, AFIP, nomenclador | PUCO, AFIP, RENAPER, ReNaPDiS 248 | HCE ley; ReNaPDiS | No evidenciado | No evidenciado |
| 3 | Dentalink | CL | softwaredentalink.com | Consultorio/clínica/cadena | SaaS nube | Estados, sobreagenda paralela, reprog. masiva | Online + redes; confirm. WA/mail/tel; IA 24/7 | Recordatorios, e-mail mkt, convenios, tareas auto | HC, odonto + perio, ortodoncia, estética, firma, IA RX/voz | Cobros, pagos online, financiamiento, caja | WA, redes, pagos | RGPD/VeriFactu (ES); guía Ley 26.529 | Cotización | +15.000 clientes (afirm.); testimonios |
| 4 | DentalSaaS | AR | dental.delriotech.com.ar | Consultorio/clínica | SaaS + portal paciente | Inteligente; bloqueos; ilimitados | Portal autogestión; WA auto ilimit. | WA automático | HC + alertas, odonto adult/infantil, perio, 6 especialidades, recetas, consentim. | Caja, OS precargadas + nomenclador, 10+ reportes | WA, white label | No evidenciado | 3 planes, montos no relevados | No evidenciado |
| 5 | AgendaPro | CL | agendapro.com/ar | Genérico (incl. dental) | SaaS + app + marketplace | Multiagenda, bloqueos, permisos | Online 24/7 + marketplace; WA pago aparte; lista espera (altos) | Recordatorios, e-mail mkt, rebound mkt | Ficha genérica + CRM; sin odontograma | POS, comisiones, inventario, presupuestos; sin AFIP/OS | WA (pago), API/ app propia (Pro), Analytics | "Cloud Security" | ARS 13.900–314.900; WA +$7.900 | +30.000 negocios; Capterra 4.8 (158) |
| 6 | Dentaly | AR | dentaly.com.ar | Independiente | SaaS nube | Diaria/semanal 1 prof. | Recordatorios WA auto | Recordatorios | HC, odonto + perio, firma digital | Finanzas, inventario, OS (lista) | WA | "Nube segura" | ARS 35.000/mes | No evidenciado |
| 7 | DenPro | AR | denpro.ar | Independ./equipo chico | SaaS nube | Calendario + lista espera (Team) | "Turnos fáciles" (s/detalle) | No evidenciado | HC, odontograma FDI, recetas | Facturación (Team), inventario, análisis | "Integraciones" s/detalle | GDPR (afirm.) | ARS 19.900 / 29.900; trial 30 d | +50 consultorios (afirm.) |
| 8 | Doctocliq | PE | doctocliq.com | Clínica/estética/fisio | SaaS + app doctores | Digital c/confirmaciones | Auto-agendamiento; pagos online; consentim. | Record. WA/mail/SMS; CRM + campañas; Soyla IA | HC, odonto + perio, ortodoncia, estética, recetas, fotos | Caja, FE (no AR), lab + inventario, reportes | WA (Meta Partner), pagos | "Altos estándares" (afirm.) | Free + trial 7 d; montos no relev. | Videos + 1 testimonio |
| 9 | DentalTec | AR | web.dentaltec.com.ar | Instituciones + prestad. | Web nube | Integrada (s/detalle) | No evidenciado | Validación auto de prácticas | HC digital + odontograma | ARCA, liquidaciones, nomencladores | ARCA, OS | Trazabilidad 100 % (declar.) | No evidenciado | 2.000+ prof.; 30+ instituc. |
| 10 | Órbita | AR | hiorbita.com | Clínica/consultorio | Gestión + Chat IA | Por sillón | Chat IA agenda 24/7 | Chat (atención + agenda + urgencias) | Ficha + odontograma | OS + caja (enunciado) | WA | No evidenciado | No evidenciado | Menciones en medios (afirm.) |
| 11 | Ninsaúde | BR | ninsaude.com | Clínicas/franquicias | SaaS nube | Multi/multi, sesiones, bloqueos 1-clic | Online + redes; check-in; confirm. auto | Confirm., e-mails, CRM, encuestas | Odonto geométrico, presup./contratos + firma, dictado IA | Finanzas, convenios, stock | API, iCal, firma, e-mail mkt | LGPD/HIPAA (páginas) | Cotización | Multi-país (afirm.) |
| 12 | Doctoralia | ES | doctoraliar.com | Especialistas/clínicas | Marketplace + agenda | Unificada multi-prof. t/real | 24/7 + Google + widget; lista espera; pagos; video | Recordatorios, relleno cancel., campañas, opiniones | Ficha digital (Plus); sin odonto | Pagos; facturación ES (Veri*factu) | Google, web VIP, Noa IA, Phone | Cifrado (declar.) | ES €89–129; AR no publ. | +4.000 clínicas ES; opiniones AR |
| 13 | OdontoApp | AR | odontoapp.com.ar | Consultorio chico | Web (SPA) | Digital (s/detalle) | No evidenciado | Recordatorios (enunciado) | HC + odontograma | No evidenciado | No evidenciado | Privacidad/términos (existen) | Página existe; monto no relev. | +10 odontólogos (afirm.) |
| 14 | Fresha | UK | fresha.com | Belleza/salud genérico | SaaS + apps + mkt | Multi-columna, recursos, grupales | 24/7 multicanal; lista espera; depósitos | Recordatorios, campañas, lealtad, reseñas | Fichas consulta; sin odonto | POS, facturas, comisiones, sueldos | Xero, Pixel/Analytics, web (add-ons) | HIPAA/ISO/GDPR | ARS 8.000 / 5.300×miembro | 120.000 negocios (afirm.) |
| 15 | SimplyBook | CY/UK | simplybook.me/es | Genérico salud | SaaS + apps | Por prof., sucursales, recursos, recurrentes | 24/7 multicanal; intake; cancela/reprog. | Retornos, reseñas, cupones, membresías | SOAP + intake; sin odonto | Pagos online/POS, depósitos, reportes | GCal/Outlook, Zapier, Zoom, API | HIPAA/ISO 27001 | Freemium; montos no relev. | 100+ NHS; testimonios |
| 16 | Bewe | CO/MX | bewe.ai | Belleza/salud PyME | SaaS + web auto | Multi-prof. (3 en base) | IA Linda WA/IG/web 24/7; reagenda + huecos | Campañas IA, ficha auto, cumpleaños | Sin clínica | Cobros + cierre diario | WA/IG/web propia | No evidenciado | USD 29/mes | Testimonios; ficha G2 |
| 17 | tab32 | US | tab32.com | Dental solo/grupo/DSO | SaaS nube HIPAA | Online + portal + formularios | Reserva online, recordatorios, portal (add-ons) | Verific. seguros IA, dictado voz | Odonto + perio, imagen, eRx | Billing, pagos, claims $0.20, analítica | Pagos, claims | HIPAA, SSO, backups | USD 125→225/mes; trial 14 d | 4.3/5 (41) Softw. Advice |
| 18 | Dentrix | US | dentrix.com | Dental/DSO | On-premise + nube | Calendario (5.0/5), multi-sede | Online/recordatorios vía add-ons | Básicos + terceros | Charting, imagen, eRx | Billing, claims US | Ecosistema HS One | HIPAA | Cotización | 4.3/5 (378) Softw. Advice |

## Anexo B — Matriz de puntuación 0–5 (pesos: turnos 25 % · clínica 20 % · integraciones 15 % · admin 15 % · paciente 10 % · seguridad 10 % · precio 5 %)

Escala: 0 ausente/no evidenciado · 1–2 parcial o solo enunciado · 3–4 comprobado funcional · 5 comprobado + diferencial. "No evidenciado" no suma. T=turnos y automatización, C=clínica odontológica, I=integraciones locales y WhatsApp, A=administración/cobros, P=experiencia paciente, S=seguridad/trazabilidad, $=precio/adopción.

| Sistema | T×0,25 | C×0,20 | I×0,15 | A×0,15 | P×0,10 | S×0,10 | $×0,05 | **Total** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| DentalSoft | 4 → 1,00 | 4 → 0,80 | 3 → 0,45 | 5 → 0,75 | 4 → 0,40 | 2 → 0,20 | 4 → 0,20 | **3,80** |
| Dentalink | 5 → 1,25 | 5 → 1,00 | 2 → 0,30 | 4 → 0,60 | 4 → 0,40 | 2 → 0,20 | 1 → 0,05 | **3,80** |
| tab32 | 4 → 1,00 | 5 → 1,00 | 2 → 0,30 | 4 → 0,60 | 3 → 0,30 | 4 → 0,40 | 2 → 0,10 | **3,70** |
| Doctocliq | 4 → 1,00 | 4 → 0,80 | 2 → 0,30 | 4 → 0,60 | 3 → 0,30 | 2 → 0,20 | 4 → 0,20 | **3,40** |
| Fresha | 5 → 1,25 | 1 → 0,20 | 2 → 0,30 | 3 → 0,45 | 5 → 0,50 | 4 → 0,40 | 4 → 0,20 | **3,30** |
| Ninsaúde | 4 → 1,00 | 4 → 0,80 | 2 → 0,30 | 3 → 0,45 | 3 → 0,30 | 3 → 0,30 | 1 → 0,05 | **3,20** |
| AgendaPro | 4 → 1,00 | 2 → 0,40 | 3 → 0,45 | 3 → 0,45 | 4 → 0,40 | 2 → 0,20 | 3 → 0,15 | **3,05** |
| SimplyBook | 4 → 1,00 | 2 → 0,40 | 3 → 0,45 | 2 → 0,30 | 4 → 0,40 | 3 → 0,30 | 3 → 0,15 | **3,00** |
| ClinIA | 3 → 0,75 | 3 → 0,60 | 4 → 0,60 | 3 → 0,45 | 2 → 0,20 | 3 → 0,30 | 1 → 0,05 | **2,95** |
| DentalSaaS | 3 → 0,75 | 4 → 0,80 | 2 → 0,30 | 4 → 0,60 | 3 → 0,30 | 1 → 0,10 | 2 → 0,10 | **2,95** |
| Dentrix | 2 → 0,50 | 5 → 1,00 | 1 → 0,15 | 4 → 0,60 | 2 → 0,20 | 3 → 0,30 | 1 → 0,05 | **2,80** |
| Doctoralia | 4 → 1,00 | 1 → 0,20 | 3 → 0,45 | 2 → 0,30 | 5 → 0,50 | 2 → 0,20 | 1 → 0,05 | **2,70** |
| Bewe | 4 → 1,00 | 0 → 0,00 | 2 → 0,30 | 2 → 0,30 | 4 → 0,40 | 1 → 0,10 | 3 → 0,15 | **2,25** |
| Dentaly | 2 → 0,50 | 3 → 0,60 | 1 → 0,15 | 2 → 0,30 | 2 → 0,20 | 1 → 0,10 | 4 → 0,20 | **2,05** |
| DenPro | 2 → 0,50 | 2 → 0,40 | 1 → 0,15 | 2 → 0,30 | 2 → 0,20 | 1 → 0,10 | 4 → 0,20 | **1,85** |
| DentalTec* | 1 → 0,25 | 2 → 0,40 | 2 → 0,30 | 3 → 0,45 | 1 → 0,10 | 2 → 0,20 | 1 → 0,05 | **1,75** |
| Órbita | 2 → 0,50 | 2 → 0,40 | 1 → 0,15 | 2 → 0,30 | 2 → 0,20 | 0 → 0,00 | 1 → 0,05 | **1,60** |
| OdontoApp | 2 → 0,50 | 2 → 0,40 | 0 → 0,00 | 0 → 0,00 | 1 → 0,10 | 1 → 0,10 | 2 → 0,10 | **1,20** |

\*DentalTec puntuado como gestión de consultorio; en su rol institucional (validación/auditoría) no tiene rival relevado.
Lectura: el top capability lo comparten DentalSoft (mejor ajuste local) y Dentalink (mejor plataforma regional). tab32 es el benchmark cloud/IA. La mitad inferior refleja sobre todo falta de evidencia pública, no necesariamente falta de producto (Órbita, OdontoApp, DentalSaaS con precios no relevados).

## Anexo C — Análisis competitivo

**Estándar de mercado (lo que todo producto debe tener)**: agenda multi-profesional diaria/semanal; reserva online 24/7; recordatorios y confirmaciones por WhatsApp/e-mail; historia clínica + odontograma; presupuestos y planes de tratamiento; caja con cobros multimedio y cierre diario; reportes de ocupación/facturación/ausentismo; roles y permisos.
**Diferenciadores reales observados**: liquidaciones de OS y comisiones (DentalSoft); interoperabilidad pública argentina PUCO/AFIP/ReNaPDiS (ClinIA); IA conversacional que agenda 24/7 (Bewe, Órbita, Soyla-Doctocliq, AI Contact Centre-Dentalink); marketplace que genera demanda (AgendaPro, Fresha, Doctoralia); laboratorio + inventario integrados (Doctocliq); sesiones/paquetes y multi-franquicia white label (Ninsaúde, DentalSaaS); IA clínica — RX, voz, resumen — (Dentalink, tab32); efecto red de opiniones (Doctoralia); pricing público transparente (tab32, Fresha, DentalSoft, Dentaly, DenPro) frente a cotización opaca (Dentalink, Ninsaúde, ClinIA, DentalTec).
**Vacíos frecuentes del mercado argentino**: (1) nadie combina OS + Mercado Pago + AFIP + WhatsApp automático + precios ARS publicados; (2) seguridad y cumplimiento sanitario sin declarar por ningún jugador local; (3) sobreturnos con anti-solapamiento, duración variable por prestación y lista de espera, poco documentados; (4) exportación de datos y auditoría débiles (riesgo de lock-in, solo Dentalink declara entrega de datos a la baja); (5) facturación electrónica y PUCO casi ausentes salvo ClinIA; (6) portal del paciente escaso.
**Oportunidades de innovación**: "todo-en-uno argentino" con precio publicado; IA de WhatsApp que agenda/reprograma/cobra de verdad (no solo responde FAQs); recuperación de inactivos y cobranza automática como motor de ingresos; reputación (reseñas Google) integrada; capa institucional (validación/auditoría estilo DentalTec) como segundo producto; onboarding con demo instantánea y migración desde Excel como estándar de adopción.

## Anexo D — Recomendación final

**5 competidores prioritarios para demo**: 1) DentalSoft (mejor ajuste local integral); 2) Dentalink (benchmark regional de plataforma + IA); 3) ClinIA (único con PUCO/AFIP/ReNaPDiS — validar profundidad real); 4) Doctocliq (plan gratis, laboratorio, Soyla IA); 5) AgendaPro (marketplace y retención; medir costo real con WhatsApp y sin odontograma).
**3 productos de referencia para UX**: Fresha (flujo de reserva, lista de espera, depósitos anti-ausencia, pricing localizado); Bewe (IA conversacional que opera el negocio 24/7); tab32 (clínica cloud, comparativas transparentes, IA que ahorra documentación).
**MVP sugerido**: *Imprescindibles* — agenda multi-profesional/por sillón con anti-solapamiento; reserva online 24/7; confirmación/cancelación/reprogramación por WhatsApp; recordatorios automáticos; HC + odontograma FDI; presupuestos y planes con seguimiento; caja multimedio + Mercado Pago + cierre diario + deudas; OS argentinas con cobertura aplicada y liquidación; comisiones por profesional; roles/permisos; reportes de ocupación/facturación/ausentismo; precios públicos en ARS. *Diferenciadores* — IA de WhatsApp que agenda; portal del paciente; recuperación de inactivos y cobranza automática; reseñas Google automáticas; demo instantánea + migración desde Excel. *Etapas posteriores* — AFIP/PUCO/ReNaPDiS; periodontograma y ortodoncia avanzada; inventario/laboratorio; multi-sucursal; API pública; app móvil; white label.

---

## 7. Verificación de fuentes — comprobación propia (2026-10-06)

### 7.1 Metodología
El 6 de octubre de 2026 se comprobaron manualmente cinco fuentes citadas en el informe —una de cada tipo exigido: sitio oficial, página de funcionalidades, términos legales, página de precios y marketplace de reseñas—.
Para cada una se contrastó lo afirmado en `discovery/sources/` con lo visible en la URL a la fecha de consulta, distinguiendo entre:
- **Funcionalidad comprobada**: visible en el producto, la documentación o los precios.
- **Afirmación comercial**: declarada sin evidencia técnica o metodológica.
- **No evidenciado**: todo dato sin respaldo comprobable.

### 7.2 Fuente 1 — Sitio oficial
**URL:** https://dentalsoft.com.ar/ — consulta 2026-10-06
**Lo que afirmaba el informe:** agenda semanal/diaria/mensual con drag & drop y detección de solapamiento, odontograma de 18 estados FDI, liquidaciones de obras sociales y comisiones, caja con Mercado Pago, turnos online en 4 pasos, planes ARS 0 / 30.000 / 60.000 y base de 300+ clínicas.
**Hallazgo:** confirmado. La landing exhibe agenda, odontograma, liquidaciones con vista previa y PDF, caja, turnos online, chatbot, planes y tres testimonios nominales. Las métricas +35% de ocupación, 8 h/semana ahorradas y -82% de ausencias figuran como banners sin metodología publicada.
**Decisión:** Continuar con ajuste de etiqueta. Funcionalidades como comprobadas; las tres cifras quedan como afirmación comercial.

### 7.3 Fuente 2 — Funcionalidades
**URL:** https://dentalsoft.com.ar/funcionalidades — consulta 2026-10-06
**Lo que afirmaba el informe:** cobertura integral de agenda, historia clínica, ortodoncia, recordatorios, caja, OS, web y asistente virtual; periodontograma no evidenciado.
**Hallazgo:** confirmado. El índice enumera agenda, ficha, odontograma, ortodoncia, estudios y escaneos 3D, documentación, presupuestos, caja, liquidaciones, inventario, roles, portal del paciente, web y chatbot. No existe mención al periodontograma.
**Decisión:** Continuar. Se ratifica `Periodontograma: No evidenciado` y se confirma `Portal del paciente: comprobado (plan Pro)`.

### 7.4 Fuente 3 — Términos legales
**URL:** https://dentalsoft.com.ar/terminos — consulta 2026-10-06
**Lo que afirmaba el informe:** existencia de páginas legales; seguridad declarada solo como "nube segura"; cifrado, backup y adecuación a Ley 26.529, Ley 25.326 e HCE no evidenciados.
**Hallazgo:** confirmado. El documento (actualizado mayo 2026) regula SaaS por suscripción, propiedad de los datos a favor de la clínica, exportación dentro de los 30 días posteriores a la baja y disponibilidad del 99%. No contiene previsiones sobre cifrado, respaldo ni normativa sanitaria argentina.
**Decisión:** Continuar. La calificación de seguridad S=2 en la matriz queda fundamentada.

### 7.5 Fuente 4 — Página de precios
**URL:** https://www.fresha.com/es/pricing — consulta 2026-10-06
**Lo que afirmaba el informe:** plan Independiente ARS 8.000/mes, Team ARS 5.300 por miembro, trial 7 días, 20 mensajes gratis y luego WhatsApp ARS 180–375, email marketing ARS 63,30, certificaciones HIPAA/ISO 27001/GDPR y 120.000 negocios; sin odontograma ni localización argentina.
**Hallazgo:** confirmado. Se precisa que los 20 mensajes gratuitos son combinados (SMS + WhatsApp). Add-ons verificados: fidelidad ARS 21.500, reseñas Google ARS 6.500, web inteligente ARS 15.500.
**Decisión:** Ajustar redacción a `20 notificaciones SMS+WA gratis combinadas`. No altera puntaje.

### 7.6 Fuente 5 — Marketplace de reseñas
**URL:** https://www.capterra.com.ar/software/218709/agendapro — consulta 2026-10-06
**Lo que afirmaba el informe:** calificación 4,8/5 con 158 reseñas; precios ARS 13.900–314.900 con WhatsApp +$7.900 vía fuente secundaria; solo prueba gratuita sin plan permanente.
**Hallazgo:** acceso por navegador logrado. Se confirma prueba gratuita de 7 días con exigencia de método de pago para activarla. Calificación y volumen coinciden. Precios ARS no figuran en detalle en la ficha, se mantienen vía fuente secundaria.
**Decisión:** Ajustar. Prueba de 7 días con método de pago pasa de afirmación comercial a funcionalidad comprobada. Precios ARS quedan como verificados por tercero.

### 7.7 Conclusión
Las 5 fuentes fueron comprobadas manualmente el 2026-10-06, validando lo relevado. Dos ajustes de precisión: Fresha (20 mensajes combinados SMS+WhatsApp) y AgendaPro/Capterra (trial 7 días con método de pago a comprobado). Precios AR de AgendaPro se conservan como verificados por terceros. Ninguna corrección altera el puntaje de la matriz ni el MVP recomendado.

## 8. Referencias
- https://dentalsoft.com.ar/ — 2026-10-06
- https://dentalsoft.com.ar/funcionalidades — 2026-10-06
- https://dentalsoft.com.ar/terminos — 2026-10-06
- https://www.fresha.com/es/pricing — 2026-10-06
- https://www.capterra.com.ar/software/218709/agendapro — 2026-10-06 (+ https://turnoapp.com.ar/blog/alternativa-a-agendapro)
- Resto de fuentes en `discovery/sources/` — 2026-10-06
