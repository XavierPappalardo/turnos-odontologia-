# Proposal — c-07-fix-programacion-recordatorios

> Change de seguimiento (follow-up) de `C-07 recordatorios-automaticos`, archivado en
> `openspec/changes/archive/2026-11-01-c-07-recordatorios-automaticos/`.
> Commit sugerido: `fix(recordatorios): cablear programacion en creacion y confirmacion de turnos`.

## Why

C-07 entregó el modelo `recordatorio` (migración 007), el worker de procesamiento
(`procesarRecordatoriosPendientes`) y la función `programarRecordatoriosParaTurno`, pero
**ningún punto de producción invoca la programación**. La única referencia a
`programarRecordatoriosParaTurno` fuera de su propia definición está en
`backend/tests/recordatorio.test.ts`. Los servicios que crean y confirman turnos
(`crearTurno`, `reservarTurnoOnline`, `cambiarEstadoTurno`, `ejecutarAccionTurno`) nunca
programan; sólo cancelan (`cancelarRecordatoriosDeTurno`) cuando el turno se cancela,
se marca ausente o se reprograma.

Consecuencia: en la aplicación real la tabla `recordatorio` nunca recibe filas, el worker
de envío nunca tiene nada que procesar y F-04 / CU-4 no se cumple. El roadmap marca C-07
como `[x]` y el camino crítico `C-07 → C-14` queda nominalmente completo pero
funcionalmente vacío: la feature está efectivamente muerta en producción.

Aclaraciones para acotar el diagnóstico (evitar atribuciones erróneas):

- **La lógica de recordatorios es de C-07.** C-11 (caja/cobros/Mercado Pago) y C-12
  (obras sociales/liquidación) no introdujeron ni modificaron lógica de recordatorios;
  sus proposals archivados ni siquiera mencionan `recordatorio`. El gap no viene de esos
  changes.
- **Los 2 tests que fallaban eran fixtures caducados.** Usaban fechas absolutas de
  noviembre 2026 que quedaron en el pasado y por eso el worker no programaba hitos. Ya
  fueron corregidos usando fechas relativas (`Date.now() + N`). No era un defecto de la
  regla de negocio ni del worker.
- **El gap real es de cableado (wiring).** La función existe, está testeada de forma
  aislada y es correcta para su contrato; simplemente no se llama desde producción.

Por qué ahora: el MVP asume una agenda que avisa sola (F-04, RN-10, CU-4). Sin
programación no hay recordatorios, no hay costo de WhatsApp que trasladar y el reporte de
C-14 no tiene actividad de notificaciones que mostrar. Es un defecto de integración de un
change MEDIUM ya archivado, no un requisito nuevo (R13 se respeta: no se agrega alcance de
producto, se completa el ya aprobado).

## What Changes

- **Cableado post-commit de la programación** en los puntos donde un turno nace o pasa a
  `confirmado`, siempre **después** de que la transacción de agenda commitea:
  - `crearTurno` (recepción, `reservado` + `origen='recepcion'`).
  - `reservarTurnoOnline` (C-05, `reservado` + `origen='online'`).
  - `ejecutarAccionTurno` con `accion='confirmar'` (C-06) y con `accion='reprogramar'`
    (turno nuevo).
  - `cambiarEstadoTurno` en la transición `reservado → confirmado` (PATCH interno de
    agenda; no abre transacción explícita, por lo que no hay anidamiento).
- **Reprogramación completa**: los pendientes del turno anterior se cancelan (ya ocurre
  hoy) **y** se programan los hitos del nuevo `inicio` sobre el turno nuevo. Hoy sólo se
  cancela: el turno reprogramado queda sin recordatorios.
- **Best-effort, sin romper la operación de agenda**: si la programación falla, la
  creación/confirmación del turno **no** se aborta ni se revierte. El error se registra
  sólo con ids opacos (R3) y la situación se repara en el siguiente punto de
  orquestación (p. ej. la confirmación) o al reprocesar, porque la función es idempotente.
- **Idempotencia**: crear y luego confirmar, o programar dos veces, no duplica filas
  (dedupe lógico por `turno_id` + `tipo`; se conserva el contrato de C-07).
- **Se conserva la regla de hitos vencidos**: si `inicio - N horas` ya pasó, ese
  recordatorio no se crea (turno demasiado próximo).
- **Configuración existente, sin variables nuevas**: se reutiliza `config.recordatorio`
  (`t48hHoras`, `t24hHoras`, `canalPredeterminado`).
- **Sin migración ni cambio de esquema.** Sin canales nuevos, sin envío real, sin cron.

Fuera de alcance de este change (explícito):

- Refactor del worker a `BaseRepository`/`RecordatorioRepository` (deuda R8 preexistente;
  este change no agrega SQL nuevo y la registra como deuda aceptada).
- Índice `UNIQUE(turno_id, tipo)` en la base (se mantiene la idempotencia **lógica**;
  ver Risks).
- Reintentos, segundo recordatorio ante falta de respuesta, plantillas y envío real por
  WhatsApp/E-mail (fuera de C-07 desde el origen).

## Capabilities

### New Capabilities

- `notificaciones/recordatorios`: programación automática de hitos T-48h/T-24h al crear,
  confirmar y reprogramar turnos; procesamiento de pendientes vencidos; cancelación por
  cambio de estado; garantías de idempotencia, hitos vencidos y ausencia de PHI.

Justificación del path: el código vive en `backend/src/notificaciones/` y KB-08 §2 lista
`/notificaciones` como el módulo de recordatorios y plantillas. No existe hoy ningún
dominio `notificaciones` en `openspec/specs/`, por lo que la capability se declara nueva
en ese path en lugar de inflar `agenda/*` con comportamiento de notificaciones.

### Modified Capabilities

- Ninguna. No cambian requisitos existentes de `agenda/crear-turno` ni de
  `agenda/bloqueos`: la programación de recordatorios es comportamiento nuevo y se
  documenta íntegramente en la capability nueva.

## Impact

- `backend/src/notificaciones/recordatorio.worker.ts` — nuevo wrapper best-effort
  (`programarRecordatoriosSeguro`) con log sin PHI; la lógica de hitos no cambia.
- `backend/src/agenda/crearTurno.service.ts` — programa post-commit; recibe
  `RecordatorioConfig` explícito.
- `backend/src/agenda/reservaOnline.service.ts` — programa post-commit; recibe
  `RecordatorioConfig` explícito.
- `backend/src/agenda/turnoEstado.service.ts` — programa al confirmar; recibe
  `RecordatorioConfig` explícito.
- `backend/src/agenda/turnoToken.service.ts` — programa al confirmar y al reprogramar
  (turno nuevo); ya recibe `AppConfig`.
- `backend/src/agenda/turnos.routes.ts` — pasa `config.recordatorio`; su firma pasa de
  `AuthConfig` a `AppConfig` (compatible: `createApp` ya entrega `AppConfig`).
- `backend/src/agenda/reservaOnline.routes.ts` — pasa `config.recordatorio`.
- `backend/src/shared/app.ts` — sin cambios: el router de recordatorios ya está montado.
- Tests: `backend/tests/recordatorio.test.ts` (pasa de llamar la función aislada a
  ejercer los servicios reales), `crear_turno.test.ts`, `turno_estado.test.ts`,
  `turno_token.test.ts`, `reserva_online.test.ts` (firma nueva + escenarios de cableado).
- Sin migración, sin dependencias externas nuevas, sin cambios en la máquina de estados
  ni en las reglas de solapamiento (C-04).
