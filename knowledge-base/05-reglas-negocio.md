# 05 — Reglas de negocio

**Fecha:** 2026-10-06
**Fuente base:** `discovery/discovery.md`, punto 7 (reglas de negocio), puntos 9–10 (restricciones y riesgos) y Anexo A.

Convención de marcado (obligatoria en cada regla): **[Comprobada]** = visible en oferta/documentación oficial; **[Afirmación]** = declarada por el proveedor sin evidencia verificable; **[Supuesto]** = hipótesis del proyecto sin validar. Toda afirmación de mercado lleva URL y fecha 2026-10-06 o "No evidenciado".

## RN-01. Anti-solapamiento por profesional — [Comprobada]
Ningún profesional puede tener dos turnos superpuestos en el mismo intervalo. Fuente: DentalSoft declara detección automática de solapamiento en sobreturnos a nivel de oferta (https://dentalsoft.com.ar/ — 2026-10-06).

## RN-02. Anti-solapamiento por sillón/box — [Comprobada a nivel de oferta / detalle No evidenciado]
Ningún sillón/box puede tener dos turnos superpuestos. La agenda por sillón está ofertada por OdontoClinIA y Órbita, pero el detalle de la regla de solapamiento por recurso no se verificó públicamente ("No evidenciado" en `discovery/sources/orbita.md` y `clinia.md` — 2026-10-06).

## RN-03. Duración variable por prestación — [Comprobada a nivel de oferta]
Cada prestación define su duración (p. ej., ficticio: limpieza 30 min, endodoncia 90 min); la agenda calcula el fin del turno automáticamente. Base: agenda con duración variable y estados/sobreagenda en Dentalink y Ninsaúde (https://www.softwaredentalink.com/ — 2026-10-06; matriz Anexo B).

## RN-04. Bloqueos de agenda — [Comprobada]
La recepción puede bloquear franjas por profesional/sillón (vacaciones, cursos, mantenimiento) y el sistema impide reservar sobre ellas. Fuente: bloqueos ofertados en DentalSoft, DentalSaaS y AgendaPro (https://dentalsoft.com.ar/ — 2026-10-06).

## RN-05. Sobreturnos controlados — [Comprobada a nivel de oferta]
El sobreturno requiere autorización explícita (rol recepción/administración) y dispara la detección de solapamiento (RN-01/RN-02). Fuente: sobreturnos con detección en DentalSoft (https://dentalsoft.com.ar/ — 2026-10-06).

## RN-06. Anticipación mínima configurable — [Supuesto operativo; valores exactos No evidenciados]
El dueño configura la antelación mínima de reserva y cancelación (p. ej., ficticio: 2 h para reservar, 12 h para cancelar sin penalidad). El Discovery la califica como práctica estándar con valores por proveedor "No evidenciados" (punto 7 — 2026-10-06).

## RN-07. Cobertura de obra social por plan — [Comprobada a nivel de oferta]
La cobertura se calcula por tratamiento y plan al momento del turno, y la diferencia queda como saldo a cobrar. Fuente: DentalSoft y DentalSaaS ofertan OS + nomenclador y liquidación (https://dentalsoft.com.ar/ — 2026-10-06; https://dental.delriotech.com.ar/ — 2026-10-06).

## RN-08. Comisiones por profesional — [Comprobada a nivel de oferta]
Comisión por porcentaje general o por tratamiento, con vista previa antes de confirmar la liquidación. Fuente: DentalSoft (https://dentalsoft.com.ar/ — 2026-10-06).

## RN-09. Cierre de caja diario — [Comprobada a nivel de oferta]
Cierre diario con trazabilidad de cobros, egresos y anulaciones; una caja solo la cierra un rol autorizado una vez por día. Fuente: DentalSoft (https://dentalsoft.com.ar/ — 2026-10-06).

## RN-10. Costo de WhatsApp trasladado — [Comprobada la existencia del costo; monto como Afirmación]
Los recordatorios y confirmaciones por WhatsApp usan la API oficial y su costo (≈ USD 0,026 por mensaje, declarado por DentalSoft; https://dentalsoft.com.ar/ — 2026-10-06) se traslada al precio del plan o se factura como excedente. Decisión aprobada.

## RN-11. Preferencia de canal online vs. WhatsApp — [Supuesto sin validar]
Se asume un uso mixto (reserva online + gestión por WhatsApp) hasta validar con usuarios reales. El Discovery lo marca como riesgo: preferencia no validada (punto 10 — 2026-10-06).

## RN-12. Precios publicados en ARS — [Comprobada la práctica; montos propios No evidenciados]
Los planes se publican en ARS desde el inicio, siguiendo a DentalSoft (ARS 0 / 30.000 / 60.000; https://dentalsoft.com.ar/ — 2026-10-06), Dentaly (ARS 35.000/mes; "No evidenciado" URL de detalle — 2026-10-06) y DenPro (ARS 19.900 / 29.900; "No evidenciado" URL de detalle — 2026-10-06). Los montos propios se definen fuera de este documento.

Datos de ejemplo de este archivo son ficticios y no corresponden a pacientes reales.
