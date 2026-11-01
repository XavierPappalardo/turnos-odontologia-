# Proposal — C-07 recordatorios-automaticos

## Identificador
- Change: `C-07 recordatorios-automaticos`
- Fecha propuesta: 2026-11-01
- Estado: `propuesta` (pendiente de aprobación antes de design)

## Contexto y dependencias
- Depende de: `C-06 confirmacion-cancelacion-reprogramacion` (archivado ✓). Reutiliza `TurnoRepository` (turnos confirmados/presente), `UnitOfWork` (`BEGIN IMMEDIATE`), `config.reservaOnline` de C-05, `hashToken` no aplica aquí.
- Gobierno: MEDIO (trabajador/background + integración WhatsApp sin credenciales reales; estructura solo, sin envío real).
- En camino crítico: sí (C-01 → C-02 → C-03 → C-04 → C-05 → C-06 → **C-07** → C-14).

## Problema que resuelve
Permitir enviar recordatorios automáticos (T-48h y T-24h, valores ficticios configurables) por WhatsApp/e-mail a pacientes con turnos confirmados o presentes, actualizando la agenda sola según la respuesta (confirmar/cancelar/ausente).

## Alcance (scope)
1. **Modelo `recordatorio`** (nueva tabla, migración 007):
   - `id`, `turno_id` (FK → turno), `tipo` ('recordatorio_48h' | 'recordatorio_24h'), `canal` ('whatsapp' | 'email'), `programado_para` (ISO 8601 UTC), `estado` ('pendiente' | 'enviado' | 'fallido' | 'cancelado'), `enviado_en` (nullable), `created_at`, `updated_at`.
   - Índice: `(estado, programado_para)` para consulta del worker.
   - Índice: `turno_id` para evitar duplicados.
2. **Worker de recordatorios** (`backend/src/notificaciones/recordatorio.worker.ts`):
   - Función `procesarRecordatoriosPendientes(db, config)` que consulta recordatorios con `estado = 'pendiente'` y `programado_para <= ahora`.
   - Para cada uno: marca `enviado_en`, cambia `estado` a 'enviado' (simulación de envío sin credenciales reales; estructura para futuro envío real por WhatsApp API oficial).
   - Transacción `BEGIN IMMEDIATE` por cada recordatorio para prevenir race conditions.
3. **Endpoints públicos de gestión** (estructura, sin autenticación JWT para simplicidad en MVP, pero protegidos por rate limiting):
   - `POST /api/public/recordatorios/procesar` — dispara el worker manualmente (para tests y demo).
   - `GET /api/public/recordatorios/pendientes` — lista recordatorios pendientes (estructura de admin).
4. **Integración con cambio de estado de turno**: cuando un turno se confirma/cancela/marca ausente (C-06), se cancelan los recordatorios pendientes asociados (estado 'cancelado').
5. **Configuración**: `recordatorioT_48h_horas` (default 48), `recordatorioT_24h_horas` (default 24), `recordatorioCanalPredeterminado` ('whatsapp').
6. **Rate limiting**: reuso de `PublicRateLimiter` de C-05 para endpoints públicos.
7. **Tests Vitest** (Dado/Cuando/Entonces):
   - crear recordatorios para un turno confirmado
   - procesar recordatorios pendientes → estado 'enviado'
   - no reprocesar recordatorios ya enviados
   - cancelar recordatorios al cambiar estado de turno
   - no duplicar recordatorios para el mismo turno/tipo

## Fuera de scope (C-07)
- Envío real de WhatsApp (API oficial de Meta con credenciales reales) — queda para integración posterior; aquí solo la estructura y simulación.
- Plantillas de mensaje personalizadas — estructura básica solo.
- Segundo recordatorio ante falta de respuesta (mencionado en FL-03) — queda para fase posterior.
- Envío por e-mail real — estructura de canal solo.

## Criterios de aceptación
- [ ] Migración 007: tabla `recordatorio` creada idempotentemente
- [ ] Worker procesa recordatorios pendientes y los marca como enviados
- [ ] No se reprocesan recordatorios ya enviados
- [ ] Los recordatorios se cancelan cuando el turno cambia de estado (confirmar/cancelar/ausente)
- [ ] Rate limiting en endpoints públicos de recordatorios
- [ ] Tests Vitest Dado/Cuando/Entonces verdes con SQLite real en memoria

## Leer antes
- `knowledge-base/06-features.md` F-04
- `knowledge-base/07-flujos.md` CU-4 (FL-03)
- `knowledge-base/05-reglas-negocio.md` §RN-10
- `knowledge-base/08-arquitectura.md` §Workers/tareas

---

¿Apruebo este proposal para proceder al diseño (design.md)?

Responder: **Sí, continuar a design** / **No, ajustar proposal**.
