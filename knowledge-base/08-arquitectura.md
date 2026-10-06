# 08 — Arquitectura

**Fecha**: 2026-10-06
**Fuente base**: `discovery/discovery.md` (2026-10-06), §5, §9, Anexo C y Anexo D.
**Stack decidido**: Node.js + Express + SQLite + Vitest (decisión aprobada por el usuario; no inventar otra cosa).

## 1. Estilo: monolito modular

Monolito modular con un solo despliegue y separación lógica por módulos. Justificación: segmento 1–10 profesionales y necesidad de onboarding en <24 h con demo sin fricción (discovery.md §9; https://dentalsoft.com.ar/ — 2026-10-06). Se evita microservicios, app móvil nativa y API pública en el MVP (ver §5).

Estructura indicativa (nombres orientativos, detalle final en README futuro):

```
/src
  /agenda      (disponibilidad, bloqueos, anti-solapamiento)
  /turnos      (CRUD turnos, estados, validación fin > inicio)
  /clinica     (profesionales, sillones, pacientes ficticios, prestaciones)
  /caja-os     (pagos, cobertura por plan, liquidación básica, comisiones)
  /notificaciones (WhatsApp API oficial, recordatorios, plantillas)
/tests         (Vitest, escenarios dado/cuando/entonces)
```

## 2. Módulos

### 2.1 Agenda / Turnos (núcleo del MVP)
- Responsabilidad: crear, confirmar, cancelar, reprogramar turnos; aplicar regla anti-solapamiento por profesional y sillón; respetar bloqueos.
- Reglas: `fin > inicio`; estados que ocupan (`reservado`, `confirmado`, `presente`) vs. estados que liberan (`cancelado`, `ausente`, `atendido`); intersección `[inicio, fin)` en transacción `BEGIN IMMEDIATE`.
- Referencia: discovery.md §7 (https://dentalsoft.com.ar/ — 2026-10-06, detección de solapamiento como funcionalidad comprobada a nivel de oferta).

### 2.2 Clínica mínima
- Profesionales, sillones/boxes, pacientes ficticios, prestaciones con duración.
- Excluye en MVP: odontograma avanzado completo, periodontograma, ortodoncia/estética (discovery.md §6 y Anexo D; periodontograma: No evidenciado — https://dentalsoft.com.ar/funcionalidades — 2026-10-06).

### 2.3 Caja / OS
- Pagos multimedio (efectivo, tarjeta, transferencia, Mercado Pago, obra social), cierre diario, cobertura por plan aplicada al turno, liquidación básica y comisiones.
- Referencia: discovery.md §5 (https://dentalsoft.com.ar/ — 2026-10-06).
- Excluye en MVP: facturación electrónica AFIP y validación PUCO (fase 2).

### 2.4 Notificaciones WhatsApp
- WhatsApp API oficial con costo trasladado al cliente (decisión aprobada).
- Referencia de costo: ≈ USD 0,026/mensaje declarado por DentalSoft (https://dentalsoft.com.ar/ — 2026-10-06, afirmación comercial); costos exactos en ARS: No evidenciado.
- En MVP: recordatorios y confirmación/cancelación con actualización de agenda. El chatbot IA que agenda 24/7 queda como diferenciador posterior (discovery.md §6 y Anexo D).

## 3. Decisiones arquitectónicas

| Decisión | Contenido | Trazabilidad |
|---|---|---|
| Sin AFIP/PUCO/ReNaPDiS en MVP | Van a fase 2 por homologaciones y dependencias del Estado | discovery.md §8 y §10 (único antecedente local: https://clinia.com.ar — 2026-10-06) |
| Sin app móvil | Solo web responsive; app móvil en etapas posteriores | discovery.md Anexo D (https://www.softwaredentalink.com/ — 2026-10-06 como referencia de plataforma) |
| Sin API pública en MVP | Integraciones externas limitadas a WhatsApp y Mercado Pago | discovery.md §8 y Anexo D |
| SQLite | Persistencia embebida suficiente para 1–10 profesionales; reserva con transacción inmediata | Decisión de stack aprobada; restricción de simplicidad (discovery.md §9) |
| Tests Vitest por escenario | Cada regla se cubre con al menos un escenario dado/cuando/entonces | Ver §4 |

## 4. Estrategia de tests (Vitest)

- Framework: Vitest (decisión aprobada).
- Formato obligatorio: `Dado / Cuando / Entonces` por escenario.
- Cobertura mínima del change "crear turno sin solapamientos":
  1. Dado un profesional libre, cuando se crea un turno válido, entonces se persiste en estado `reservado`.
  2. Dado un turno activo, cuando se crea otro superpuesto del mismo profesional, entonces se rechaza.
  3. Dado un turno activo, cuando se crea otro superpuesto en el mismo sillón, entonces se rechaza.
  4. Dado un turno `cancelado`, cuando se reserva el mismo hueco, entonces se permite.
  5. Dado un bloqueo vigente, cuando se reserva un turno intersectado, entonces se rechaza.
  6. Dado `fin <= inicio`, cuando se crea el turno, entonces se rechaza por validación.
- Sin datos reales: solo fixtures ficticios.

## 5. Cómo correr tests (según README futuro)

El README del repositorio será la fuente autoritativa. Procedimiento previsto (no ejecutar si el README indica otro):

1. Instalar dependencias: `npm install`.
2. Ejecutar suite: `npm test` (Vitest).
3. Ejecución vigilada / archivo único según README (p. ej. `npx vitest run`).
4. Si el README futuro contradice este documento, prevalece el README.

## 6. Lo explícitamente fuera del MVP

AFIP/PUCO/ReNaPDiS, portal del paciente, white label, API pública, app móvil, periodontograma, inventario/laboratorio, multi-sucursal (discovery.md §6 y Anexo D).
