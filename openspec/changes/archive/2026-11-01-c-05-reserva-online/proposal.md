# Proposal — C-05 reserva-online

## Identificador
- Change: `C-05 reserva-online`
- Fecha propuesta: 2026-11-01
- Estado: `propuesta` (pendiente de aprobación antes de design)

## Contexto y dependencias
- Depende de: `C-04 agenda-turnos-overlaps` (archivado ✓). Reutiliza `TurnoRepository` (existe solape profesional/sillón), `BloqueoRepository` (bloqueos aplicables), `UnitOfWork` (`BEGIN IMMEDIATE`), auth de C-03 (no se usa JWT aquí: es endpoint público), `TurnoOrigen.online`.
- Gobierno: ALTO (endpoints públicos sin autenticación: superficie de abuso, rate limiting obligatorio).
- En camino crítico: sí (C-01 → C-02 → C-03 → C-04 → **C-05** → C-06 → C-07 → C-14).

## Problema que resuelve
Permitir a cualquier paciente reservar un turno 24/7 sin necesidad de autenticación ni rol de recepción, respetando las mismas reglas de negocio que la creación interna (anti-solapamiento por profesional y sillón, bloqueos, anticipación mínima RN-06, fin > inicio).

## Alcance (scope)
1. `GET /api/public/agenda/disponibilidad` — consulta horarios libres para un profesional/sillón en una fecha (usa lógica de solape existente).
2. `POST /api/public/turnos` — crea un turno con `origen = 'online'` sin JWT, validando:
   - fin > inicio
   - FKs existentes y activos (profesional, sillón, paciente; prestación opcional)
   - sin solape profesional ni solape sillón (estados activos)
   - no intersectar bloqueo aplicable
   - anticipación mínima configurable (RN-06): `inicio` debe ser ≥ ahora + ventana configurable
3. Validación de entrada y anti-abuso:
   - Rate limiting por IP para reservas públicas (configurable, distinto al de login)
   - Cuerpo sin PHI en errores (solo ids opacos + `eje`)
   - Respuesta `201` con turno en estado `reservado`; `400`/`409` con `eje`
4. Tests Vitest (Dado/Cuando/Entonces):
   - disponibilidad devuelve huecos libres
   - reserva exitosa crea turno `reservado` con origen `online`
   - solapamiento detectado (409 eje profesional / sillón / bloqueo)
   - fin <= inicio (400)
   - sin anticipación mínima (400)

## Fuera de scope (C-05)
- Autenticación del paciente (queda para C-17 portal-paciente)
- Envío de confirmación por WhatsApp (queda para C-06)
- Recordatorios automáticos (queda para C-07)
- Migración de base de datos nueva: no se añade migración; se reusan tablas de C-02/C-03/C-04 (turno ya tiene `origen` con valor `online` permitido)

## Criterios de aceptación
- [ ] `GET /api/public/agenda/disponibilidad` responde horarios libres respetando solape y bloqueos
- [ ] `POST /api/public/turnos` crea turno `reservado` con `origen = 'online'` sin autenticación
- [ ] Anticipación mínima (RN-06) aplicable y configurable
- [ ] Rate limiting por IP en endpoints públicos
- [ ] Tests Vitest Dado/Cuando/Entonces verdes con SQLite real en memoria

## Leer antes
- `knowledge-base/06-features.md` F-02
- `knowledge-base/07-flujos.md` CU-1
- `knowledge-base/05-reglas-negocio.md` §RN-06
- `knowledge-base/08-arquitectura.md` §APIs públicos vs privados
- `knowledge-base/04-modelos-datos.md` §5, §6, §9

---

¿Apruebo este proposal para proceder al diseño (design.md)?

Responder: **Sí, continuar a design** / **No, ajustar proposal**.
