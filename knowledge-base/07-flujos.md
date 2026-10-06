# 07 — Flujos principales

**Fecha:** 2026-10-06
**Fuente base:** `discovery/discovery.md`, puntos 3 (casos de uso), 7 (reglas) y 8 (integraciones).

Personas, DNI, teléfonos y montos de ejemplo son ficticios. Ningún dato corresponde a pacientes reales.

## FL-01. Reservar turno online (CU-1, CU-3)

1. El paciente abre el link de reserva 24/7 y elige profesional, prestación, fecha y horario disponibles (la agenda aplica RN-01/RN-02 anti-solapamiento y RN-04 bloqueos).
2. El sistema calcula la duración por prestación (RN-03) y, si indica obra social y plan, estima la cobertura (RN-07).
3. El paciente confirma con nombre y WhatsApp ficticios (p. ej., "Paciente Ejemplo", +54 9 11 0000-0000); el turno queda en estado Pendiente de confirmación.
4. El sistema envía confirmación por WhatsApp (API oficial; costo ≈ USD 0,026 trasladado; https://dentalsoft.com.ar/ — 2026-10-06).

## FL-02. Confirmar / cancelar / reprogramar por WhatsApp (CU-2, CU-4)

1. El paciente recibe el mensaje con botones o link (confirmar / cancelar / reprogramar).
2. Al responder, la agenda se actualiza sola sin intervención de recepción (antecedente: reagendamiento automático declarado por OdontoClinIA; "No evidenciado" en detalle — 2026-10-06).
3. La cancelación respeta la anticipación mínima configurable (RN-06); fuera de plazo, el turno se marca como cancelación tardía para reportes de ausentismo.
4. La reprogramación vuelve a validar disponibilidad (RN-01/RN-02) y duración (RN-03).

## FL-03. Recordatorio automático (CU-4)

1. T-48 h y T-24 h (valores ficticios configurables): envío automático por WhatsApp/e-mail.
2. Sin respuesta: segundo recordatorio; con respuesta negativa o ausencia: el hueco se libera para sobreturno o lista de espera (práctica de referencia: lista de espera en Fresha/AgendaPro; https://www.fresha.com/es/pricing — 2026-10-06; https://www.capterra.com.ar/software/218709/agendapro — 2026-10-06).
3. Todo mensaje por WhatsApp computa el costo Meta trasladable (RN-10).

## FL-04. Cobro con Mercado Pago + obra social (CU-6, CU-7)

1. En recepción, el turno confirmado genera el cargo: total prestación menos cobertura del plan (RN-07).
2. El paciente paga la diferencia por Mercado Pago (online o QR), tarjeta, transferencia o efectivo; ejemplo ficticio: prestación ARS 50.000, cobertura ARS 30.000, saldo ARS 20.000.
3. El cobro registra medio de pago, profesional y obra social; la deuda impaga entra en gestión automática de cobranza (diferenciador D-03).
4. Cierre de caja diario con traza de egresos y anulaciones (RN-09).

## FL-05. Liquidación de comisiones (CU-7, CU-8)

1. Período configurable (p. ej., ficticio: mensual): el sistema agrega producción cobrada por profesional, aplica el porcentaje general o por tratamiento (RN-08) y muestra vista previa.
2. Administración confirma; el resultado alimenta el tablero del dueño (ocupación, facturación, rentabilidad, ausentismo).
3. La liquidación de reintegros de obras sociales corre en paralelo (RN-07); AFIP/PUCO quedan fuera hasta fase 2 por decisión aprobada.
