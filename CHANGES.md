# CHANGES — Secuencia de Implementación

> Índice canónico de todos los changes del proyecto **turnos-odontologia**.
> Cada change es atómico: un agente puede implementarlo en una sesión (~4-6 horas).
> **Leer este archivo antes de ejecutar cualquier `/opsx:propose`.**

---

## Cómo usar este documento

1. Identificar el change a implementar (verificar que sus dependencias están en `openspec/changes/archive/`).
2. Leer los docs de la knowledge-base indicados en "Leer antes".
3. Ejecutar `/opsx:propose <nombre-del-change>`.
4. Al terminar el change, archivarlo con `/opsx:archive <nombre-del-change>`.
5. Marcar el checkbox `[x]` en este archivo.

---

## Árbol de dependencias

```
C-01 foundation-setup
  └── C-02 core-models
        └── C-03 auth-roles-permisos
              │
              ├── C-04 agenda-turnos-overlaps        ← MANDATORIO: profesional + sillón
              │     │
              │     ├── C-05 reserva-online
              │     │     ├── C-06 confirmacion-cancelacion-reprogramacion
              │     │     └── C-07 recordatorios-automaticos
              │     │
              │     └── C-08 bloqueos-agenda
              │
              ├── C-09 historia-clinica-odontograma
              │     └── C-10 presupuestos-planes-tratamiento
              │           └── C-11 caja-cobros-multimedio-mercadopago
              │
              ├── C-12 obras-sociales-liquidacion
              │     └── C-13 comisiones-profesional
              │
              ├── C-14 reportes-ocupacion-facturacion-ausentismo
              │
              └── C-15 precios-publicos-ars
                    │
                    ├── C-16 ia-chatbot-whatsapp-agenda  (Diferenciador)
                    ├── C-17 portal-paciente              (Diferenciador)
                    ├── C-18 recuperacion-inactivos-cobranza (Diferenciador)
                    ├── C-19 reseñas-google-automaticas   (Diferenciador)
                    └── C-20 demo-migracion-excel         (Diferenciador)
```

### Paralelismo por fase

> Cada "gate" es un punto de sincronización. Los changes dentro de un grupo pueden ejecutarse en paralelo.

```
GATE 0: ninguna
  → C-01 foundation-setup

GATE 1: C-01 ✓
  → C-02 core-models

GATE 2: C-02 ✓
  → C-03 auth-roles-permisos

GATE 3: C-03 ✓                     ← PRIMER FORK
  → C-04 agenda-turnos-overlaps    [Agente A]
  → C-09 historia-clinica-odontograma [Agente B]
  → C-12 obras-sociales-liquidacion [Agente C]

GATE 4: C-04 ✓
  → C-05 reserva-online            [Agente A]
  → C-08 bloqueos-agenda           [Agente B]

GATE 5: C-05 ✓
  → C-06 confirmacion-cancelacion-reprogramacion [Agente A]
  → C-07 recordatorios-automaticos [Agente B]

GATE 6: C-09 ✓
  → C-10 presupuestos-planes-tratamiento [Agente B]

GATE 7: C-10 ✓
  → C-11 caja-cobros-multimedio-mercadopago [Agente B]

GATE 8: C-12 ✓
  → C-13 comisiones-profesional    [Agente C]

GATE 9: C-04, C-09, C-10, C-11, C-12, C-13 ✓
  → C-14 reportes-ocupacion-facturacion-ausentismo [Agente A]
  → C-15 precios-publicos-ars      [Agente C]

GATE 10: C-15 ✓                    ← ÚLTIMO FORK (5 paralelos diferenciadores)
  → C-16 ia-chatbot-whatsapp-agenda [Agente A]
  → C-17 portal-paciente            [Agente B]
  → C-18 recuperacion-inactivos-cobranza [Agente C]
  → C-19 reseñas-google-automaticas [Agente A]
  → C-20 demo-migracion-excel       [Agente B]
```

### Camino crítico (9 changes — mínimo irreducible)
```
C-01 → C-02 → C-03 → C-04 → C-05 → C-06 → C-07 → C-14 → (o C-15 según cierre)
```
> Camino crítico hasta MVP operativo: C-01, C-02, C-03, C-04, C-05, C-06, C-07, C-14. C-15 es transversal de precios; componentes diferenciadores (C-16–C-20) no forman parte del MVP irreducible.

### Plan óptimo con 3 agentes

```
Paso │ Agente A (Backend Core / Agenda) │ Agente B (Backend Aux / Clínica) │ Agente C (Frontend/Integraciones)
─────┼───────────────────────────────────┼──────────────────────────────────┼─────────────────────────────────────
  1  │ C-01 foundation-setup             │ —                                │ —
  2  │ C-02 core-models                  │ —                                │ —
  3  │ C-03 auth-roles-permisos          │ —                                │ —
  4  │ C-04 agenda-turnos-overlaps       │ C-09 historia-clinica-odontograma │ C-12 obras-sociales-liquidacion
  5  │ C-05 reserva-online               │ C-08 bloqueos-agenda             │ —
  6  │ C-06 confirmacion-cancelacion-reprogramacion │ C-07 recordatorios-automaticos │ —
  7  │ —                                 │ C-10 presupuestos-planes-tratamiento │ —
  8  │ —                                 │ C-11 caja-cobros-multimedio-mercadopago │ —
  9  │ —                                 │ —                                │ C-13 comisiones-profesional
  10 │ C-14 reportes-ocupacion-facturacion-ausentismo │ — │ C-15 precios-publicos-ars
  11 │ C-16 ia-chatbot-whatsapp-agenda, C-19 reseñas-google-automaticas │ C-17 portal-paciente, C-20 demo-migracion-excel │ C-18 recuperacion-inactivos-cobranza
```

---

## FASE 0 — Cimientos

### [C-01] `foundation-setup`
- **Estado**: `[ ]` pendiente
- **Scope**: Scaffolding completo del proyecto + infraestructura base (alineado a arquitectura MVP)
  - Estructura de directorios: `backend/`, `frontend/`, `docs/`, `knowledge-base/`, `discovery/` según `08-arquitectura.md` §Arquitectura general
  - `backend/`: app mínima con health check `/api/health`, migraciones iniciales, `shared/` con settings, logger, db, exceptions
  - `frontend/`: scaffolding base (según stack actual), tooling para lint/test, estructura de componentes
  - `.env.example` en cada sub-proyecto (sin secretos reales)
  - Configuración de base de datos inicial (SQLite para MVP, migraciones gestionadas)
  - Scripts de desarrollo, CI mínimo, variables via `${VAR}` sin defaults hardcodeados
  - Tests base vacíos con runners configurados
- **Dependencias**: ninguna
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/01-vision.md` (propósito y alcance)
  - `knowledge-base/02-descripcion.md` §2.1 Stack/arquitectura
  - `knowledge-base/08-arquitectura.md` §Arquitectura general y estructura de directorios
  - `knowledge-base/09-decisiones.md` §Decisiones técnicas (stack)

---

### [C-02] `core-models`
- **Estado**: `[ ]` pendiente
- **Scope**: Modelos base + migraciones iniciales + seed mínimo (entidades núcleo para anti-solapamiento)
  - Modelos: `Profesional`, `SillonBox`, `Paciente`, `Prestacion`, `Turno`, `Bloqueo`, `ObraSocialPlan`, `Pago` (según `04-modelos-datos.md`)
  - Mixins/auditoría comunes: `AuditMixin` (`created_at`, `updated_at`, `deleted_at`, `activo`)
  - Repositorios base (`BaseRepository[T]`), unidad de trabajo (`UnitOfWork`)
  - Migración 001: tablas core (con claves, FKs, CHECKs: `fin > inicio`, `duracion_min > 0`, `0 ≤ cobertura_pct ≤ 100`, `monto_centavos ≥ 0`)
  - Índices para consultas de solapamiento por intervalo: `(profesional_id, inicio, fin)`, `(sillon_id, inicio, fin)`
  - Seed mínimo: 1 profesional, 1 sillón, 1 prestación, 1 obra social plan, 1 paciente (fixtures ficticios)
  - Tests: validación de CHECKs y estructura de modelos
- **Dependencias**: C-01
- **Governance**: CRITICO
- **Leer antes**:
  - `knowledge-base/04-modelos-datos.md` §1–10 (entidades, restricciones, estados, diagrama)
  - `knowledge-base/05-reglas-negocio.md` §RN-01, RN-02, RN-03, RN-04
  - `knowledge-base/08-arquitectura.md` §Patrones (Repository/UoW, capas)
  - `knowledge-base/09-decisiones.md` (decisiones de modelado)

---

## FASE 1 — Autenticación y RBAC

### [C-03] `auth-roles-permisos`
- **Estado**: `[ ]` pendiente
- **Scope**: Autenticación + RBAC alineado a actores (recepción, profesional, administración)
  - Modelos: `User`, `Role`, `UserRole` (basado en `03-actores.md`)
  - Endpoints auth: `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me`
  - RBAC: roles `recepcion`, `profesional`, `administracion` + permisos por recurso
  - JWT: claims `sub`, `tenant_id`, `roles`, `email`, `jti`, `type`, `iat`, `exp`
  - Seguridad: refresh en cookie HttpOnly (secure, samesite=lax), rotación y blacklist
  - Rate limiting (e.g. 5/60s por IP+email) para login
  - Migración 002: tablas auth
  - Tests: login/refresh/logout, validación de roles, acceso denegado
- **Dependencias**: C-02
- **Governance**: CRITICO
- **Leer antes**:
  - `knowledge-base/03-actores.md` (roles, responsabilidades)
  - `knowledge-base/05-reglas-negocio.md` (requisitos transversales)
  - `knowledge-base/07-flujos.md` §Flujos principales (auth)
  - `knowledge-base/08-arquitectura.md` §Seguridad/autenticación

---

## FASE 2 — Agenda, Turnos y Solapamientos (MVP Core)

### [C-04] `agenda-turnos-overlaps`
- **Estado**: `[ ]` pendiente
- **Scope**: **MANDATORIO** — Crear turno evitando solapamientos por profesional AND por sillón/box, con reglas verificables
  - Lógica de anti-solapamiento (RN-01, RN-02): consulta de intersección `[inicio, fin)` en estados activos (`reservado`, `confirmado`, `presente`)
  - Validación vs Bloqueos aplicables (profesional/sillón, NULL=global) — RN-04
  - Transacciones con `BEGIN IMMEDIATE` (SQLite) para prevenir race conditions
  - Endpoint: `POST /api/turnos` (creación) con validaciones (fin>inicio, duración vs prestación)
  - Máquina de estados mínima y validación de transiciones (RN-06/RN-05 implícitos)
  - Migración 003: ajustes índices/constraints para soporte de solapamientos
  - **Tests obligatorios**: escenarios dado/cuando/entonces para profesional overlap, sillón/box overlap, sin overlap, bloqueos, cambio de estado libera hueco
- **Dependencias**: C-03
- **Governance**: CRITICO
- **Leer antes**:
  - `knowledge-base/04-modelos-datos.md` §5, §6, §9 (Turno, Bloqueo, restricciones, estados)
  - `knowledge-base/05-reglas-negocio.md` §RN-01, RN-02, RN-04, RN-05
  - `knowledge-base/07-flujos.md` §CU-3 y flujo de reserva
  - `knowledge-base/06-features.md` F-01
  - `knowledge-base/10-preguntas-abiertas.md` (supuestos sobre origen/estados)

---

### [C-05] `reserva-online`
- **Estado**: `[ ]` pendiente
- **Scope**: Reserva online 24/7 (F-02) sin fricción excesiva
  - Endpoints públicos: `GET /api/public/agenda/disponibilidad`, `POST /api/public/turnos` (reserva online)
  - Flujo de creación con validaciones de disponibilidad por profesional/sillón
  - Integración con lógica de overlaps y bloqueos
  - Configuración de anticipación mínima configurable (RN-06)
  - Validaciones de entrada, anti-abuso, rate limiting para reservas públicas
  - Tests: disponibilidad, reserva exitosa, solapamiento detectado, bloqueado
- **Dependencias**: C-04
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/06-features.md` F-02
  - `knowledge-base/07-flujos.md` CU-1
  - `knowledge-base/05-reglas-negocio.md` §RN-06
  - `knowledge-base/08-arquitectura.md` §APIs públicos vs privados

---

### [C-06] `confirmacion-cancelacion-reprogramacion`
- **Estado**: `[ ]` pendiente
- **Scope**: Confirmación/cancelación/reprogramación por WhatsApp o link (F-03)
  - Endpoints: `POST /api/turnos/{id}/confirmar`, `POST /api/turnos/{id}/cancelar`, `POST /api/turnos/{id}/reprogramar`
  - Links de acción con tokens (seguro, corto plazo) para gestión por paciente
  - Integración con WhatsApp (estructura para envío de enlaces/acciones)
  - Validación de transiciones de estado y liberación de hueco al cancelar/ausente/atendido
  - Anticipación mínima para cancelación (RN-06)
  - Tests: transiciones válidas/inválidas, reprogramación sin crear solapamiento
- **Dependencias**: C-05
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/06-features.md` F-03
  - `knowledge-base/07-flujos.md` CU-2
  - `knowledge-base/05-reglas-negocio.md` §RN-06
  - `knowledge-base/04-modelos-datos.md` §9 (estados)

---

### [C-07] `recordatorios-automaticos`
- **Estado**: `[ ]` pendiente
- **Scope**: Recordatorios automáticos con actualización sola de la agenda (F-04)
  - Tareas/worker para recordatorios (programación por fecha/hora de turno)
  - Canales: WhatsApp + email (estructura configurable)
  - Integración con gestión de respuestas para actualizar estado/agenda (RN-10)
  - Registro de envíos, reintentos, estado de entrega
  - Configuración de tiempos de recordatorio (configurable)
  - Tests: programación, envío, actualización de agenda
- **Dependencias**: C-06
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06-features.md` F-04
  - `knowledge-base/05-reglas-negocio.md` §RN-10
  - `knowledge-base/07-flujos.md` CU-4
  - `knowledge-base/08-arquitectura.md` §Workers/tareas

---

### [C-08] `bloqueos-agenda`
- **Estado**: `[ ]` pendiente
- **Scope**: Bloqueos de agenda (feriados, mantenimiento, ausencias) — RN-04
  - Modelo `Bloqueo` ya definido; CRUD admin: `POST/GET/PUT/DELETE /api/bloqueos`
  - Validación de intersección con turnos activos al crear/actualizar bloqueos
  - Soporte `profesional_id` NULL (global) y `sillon_id` NULL (global)
  - Integración con disponibilidad pública y privada
  - Tests: bloqueo impide reserva, turno no puede crearse sobre bloqueo
- **Dependencias**: C-04
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/04-modelos-datos.md` §6
  - `knowledge-base/05-reglas-negocio.md` §RN-04
  - `knowledge-base/06-features.md` F-01
  - `knowledge-base/07-flujos.md` CU-3

---

## FASE 3 — Clínica (Historia, Presupuestos, Caja)

### [C-09] `historia-clinica-odontograma`
- **Estado**: `[ ]` pendiente
- **Scope**: Historia clínica + odontograma FDI (F-05)
  - Estructura para HC: registro por turno/paciente, notas, eventos
  - Odontograma FDI (estructura básica, estados por pieza)
  - Endpoints: CRUD HC, obtener por paciente/turno
  - Permisos por rol (profesional/recepción/admin)
  - Migración 004: tablas HC/odontograma
  - Tests: creación/lectura HC, validación de permisos
- **Dependencias**: C-03
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/06-features.md` F-05
  - `knowledge-base/07-flujos.md` CU-5
  - `knowledge-base/08-arquitectura.md` §Modelo clínico
  - `knowledge-base/09-decisiones.md` (decisiones clínicas)

---

### [C-10] `presupuestos-planes-tratamiento`
- **Estado**: `[ ]` pendiente
- **Scope**: Presupuestos y planes de tratamiento con seguimiento hasta cobro (F-06)
  - Modelos: `Presupuesto`, `ItemPresupuesto`, `PlanTratamiento`, `EtapaPlan`
  - Estados de presupuesto/plan, seguimiento hasta cobro
  - Endpoints CRUD + conversión presupuesto→plan/turno
  - Cálculos con precios en ARS, totales
  - Migración 005: tablas presupuestos/planes
  - Tests: cálculo, estados, seguimiento
- **Dependencias**: C-09
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06-features.md` F-06
  - `knowledge-base/07-flujos.md` CU-5, CU-6
  - `knowledge-base/05-reglas-negocio.md` §RN-12
  - `knowledge-base/08-arquitectura.md` §Negocio

---

### [C-11] `caja-cobros-multimedio-mercadopago`
- **Estado**: `[ ]` pendiente
- **Scope**: Caja multimedio + Mercado Pago + cierre diario + gestión de deudas (F-07)
  - Modelo `Pago` extendido: medios (`efectivo`, `tarjeta`, `transferencia`, `mercadopago`, `obra_social`), estados (`pendiente`, `cobrado`, `anulado`)
  - Caja/cierre diario con trazabilidad (RN-09)
  - Integración Mercado Pago (estructura sin credenciales reales; referencias comerciales)
  - Gestión de deudas/saldos por turno/paciente
  - Endpoints: registrar pago, cerrar caja, ver deudas
  - Migración 006: ajustes caja/pagos
  - Tests: cobro multimedio, cierre diario, trazabilidad
- **Dependencias**: C-10
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/04-modelos-datos.md` §8
  - `knowledge-base/05-reglas-negocio.md` §RN-09
  - `knowledge-base/06-features.md` F-07
  - `knowledge-base/07-flujos.md` CU-6
  - `knowledge-base/08-arquitectura.md` §Pagos

---

## FASE 4 — Obra Social, Comisiones y Reportes

### [C-12] `obras-sociales-liquidacion`
- **Estado**: `[ ]` pendiente
- **Scope**: Obras sociales argentinas: cobertura por plan + liquidación (F-08)
  - Modelos `ObraSocialPlan` (ya definido) + lógica de cobertura por plan/tratamiento
  - Cálculo de cobertura y saldo a cobrar (RN-07)
  - Liquidación de reintegros (estructura)
  - Migración 007: ajustes OS/liquidación
  - Tests: cálculo cobertura, saldo, reintegros
- **Dependencias**: C-03
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/04-modelos-datos.md` §7
  - `knowledge-base/05-reglas-negocio.md` §RN-07
  - `knowledge-base/06-features.md` F-08
  - `knowledge-base/07-flujos.md` CU-6, CU-7
  - `knowledge-base/10-preguntas-abiertas.md` (PUCO fase 2)

---

### [C-13] `comisiones-profesional`
- **Estado**: `[ ]` pendiente
- **Scope**: Liquidación de comisiones por profesional (F-09)
  - Reglas de comisión: % general o por tratamiento (RN-08)
  - Vista previa antes de confirmar liquidación
  - Cálculo basado en cobros/liquidaciones
  - Endpoints/admin para generar liquidación por profesional
  - Migración 008: tablas comisiones/liquidaciones
  - Tests: cálculo por tratamiento, vista previa, confirmación
- **Dependencias**: C-12
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/05-reglas-negocio.md` §RN-08
  - `knowledge-base/06-features.md` F-09
  - `knowledge-base/07-flujos.md` CU-7

---

### [C-14] `reportes-ocupacion-facturacion-ausentismo`
- **Estado**: `[ ]` pendiente
- **Scope**: Reportes de ocupación, facturación y ausentismo (F-11)
  - Dashboards/admin: ocupación por profesional/sillón, facturación, ausentismo
  - Métricas agregadas (diarias/semanales/mensuales)
  - Exportación CSV (opcional)
  - Tests: cálculo de métricas, agregaciones
- **Dependencias**: C-04, C-09, C-10, C-11, C-12, C-13
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06-features.md` F-11
  - `knowledge-base/07-flujos.md` CU-8
  - `knowledge-base/08-arquitectura.md` §Reportes

---

### [C-15] `precios-publicos-ars`
- **Estado**: `[ ]` pendiente
- **Scope**: Precios públicos en ARS (F-12) — transversal
  - Configuración/catalogo con precios en ARS
  - Validaciones monetarias (centavos), moneda ARS
  - Exposición pública de precios donde aplique (reserva online)
  - Migración 009: ajustes catálogo/precios
  - Tests: validación ARS, formato, consistencia
- **Dependencias**: C-04, C-10, C-11
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/06-features.md` F-12
  - `knowledge-base/05-reglas-negocio.md` §RN-12
  - `knowledge-base/09-decisiones.md` §Decisiones comerciales

---

## FASE 5 — Diferenciadores (Post-MVP temprano)

### [C-16] `ia-chatbot-whatsapp-agenda`
- **Estado**: `[ ]` pendiente
- **Scope**: IA/chatbot de WhatsApp que agenda 24/7 (D-01)
  - Integración WhatsApp API (estructura sin credenciales reales)
  - Flujo conversacional para agendar/confirmar/reprogramar
  - Conexión con disponibilidad y lógica de overlaps
  - Manejo de estado conversacional, errores, límites
  - Tests: flujo básico de agenda vía chatbot
- **Dependencias**: C-15
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06-features.md` D-01
  - `knowledge-base/07-flujos.md` CU-1, CU-2, CU-4
  - `knowledge-base/05-reglas-negocio.md` §RN-10, RN-11
  - `knowledge-base/10-preguntas-abiertas.md` (preferencia online-vs-WhatsApp)

---

### [C-17] `portal-paciente`
- **Estado**: `[ ]` pendiente
- **Scope**: Portal del paciente (turnos, presupuestos, documentos) — fase 2 temprana (D-02)
  - Autenticación paciente (mínima) o acceso por link/token
  - Secciones: mis turnos, presupuestos, documentos
  - Gestión propia: confirmar/cancelar/reprogramar
  - UI básica responsive
  - Tests: acceso, visualización, acciones
- **Dependencias**: C-15
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06-features.md` D-02
  - `knowledge-base/07-flujos.md` CU-9
  - `knowledge-base/08-arquitectura.md` §Frontend/portal

---

### [C-18] `recuperacion-inactivos-cobranza`
- **Estado**: `[ ]` pendiente
- **Scope**: Recuperación de pacientes inactivos y cobranza automática (D-03)
  - Segmentación de inactivos, campañas
  - Cobranza automática (recordatorios de deuda)
  - Integración con caja/deudas (C-11)
  - Configuración de reglas y ventanas
  - Tests: segmentación, envío, seguimiento
- **Dependencias**: C-15
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/06-features.md` D-03
  - `knowledge-base/07-flujos.md` CU-6, CU-8

---

### [C-19] `reseñas-google-automaticas`
- **Estado**: `[ ]` pendiente
- **Scope**: Solicitud automática de reseñas en Google (D-04)
  - Disparador post-atención (estado atendido)
  - Envío de link a reseña (Google) vía WhatsApp/email
  - Registro de solicitudes/enviados
  - Tests: disparador, envío
- **Dependencias**: C-15
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/06-features.md` D-04
  - `knowledge-base/07-flujos.md` CU-8
  - `knowledge-base/08-arquitectura.md` §Marketing

---

### [C-20] `demo-migracion-excel`
- **Estado**: `[ ]` pendiente
- **Scope**: Demo instantánea + migración desde Excel (D-05)
  - Seed/demo data para demo instantánea
  - Importador CSV/Excel para migración básica (pacientes, profesionales, turnos)
  - Validaciones, mapeos, reporte de errores
  - UI para carga/preview
  - Tests: importación válida/inválida, preview
- **Dependencias**: C-15
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/06-features.md` D-05
  - `knowledge-base/09-decisiones.md` §Adopción/onboarding
  - `knowledge-base/08-arquitectura.md` §Utilidades

---

## Riesgos principales

| Riesgo | Probabilidad | Impacto | Mitigación | Referencia KB/Discovery |
|---|---|---|---|---|
| **Supuesto preferencia online-vs-WhatsApp sin validar** | Media | Alto | Validar con usuarios antes de priorizar portal/app; mantener WhatsApp como canal primario (C-06, C-07). | `10-preguntas-abiertas.md` (P-06); `discovery/discovery.md` §10 |
| **Riesgo regulatorio (datos salud/privacidad)** | Baja-Media | Alto | Diseñar cifrado, backups, control acceso, consentimientos desde día 1; asesoría legal. No declarar cumplimiento pleno local aún. | `discovery/discovery.md` §10 (Ley 26.529, 25.326, HCE) |
| **Costo WhatsApp API** | Media | Medio-Alto | Trasladar costo explícitamente (RN-10); monitorear uso; configurar límites. | `05-reglas-negocio.md` §RN-10; `discovery/discovery.md` §9 |
| **Race conditions en solapamientos (SQLite)** | Baja | Alto | Usar transacciones `BEGIN IMMEDIATE` + consulta de intersección + tests exhaustivos (C-04). | `04-modelos-datos.md` §5.1; `05-reglas-negocio.md` §RN-01, RN-02 |
| **Homologaciones AFIP/PUCO/ReNaPDiS fuera de MVP** | Media | Bajo | Quedan explícitamente fuera; no incluidos (etapas posteriores). | `discovery/discovery.md` Anexo D; `10-preguntas-abiertas.md` (P-02) |
| **Alcance sobredimensionado (diferenciadores)** | Media | Medio | Diferenciadores separados (C-16–C-20) tras C-15; críticos primero (MVP). | `discovery/discovery.md` Anexo D |
| **Adopción (migración Excel/papel)** | Baja-Media | Medio | Incluir demo+migración (C-20) y onboarding simple. | `discovery/discovery.md` §9, Anexo D |

---

## Checklist de validación al cerrar

- [x] El header dice "CHANGES — Secuencia de Implementación".
- [x] La sección "Cómo usar este documento" tiene los 5 pasos numerados.
- [x] El "Árbol de dependencias" usa ASCII art con `└──` y `│`.
- [x] Hay al menos un GATE por cada fork de paralelismo detectado (GATE 0-10).
- [x] El camino crítico tiene una flecha lineal sin ramas.
- [x] La tabla de "Plan óptimo con 3 agentes" tiene 3 columnas y los pasos enumerados.
- [x] Cada change tiene exactamente 5 campos: Estado, Scope, Dependencias, Governance, Leer antes.
- [x] Cada "Leer antes" tiene 3 a 5 archivos KB con sección cuando aplique.
- [x] El Scope tiene bullets operacionales (modelos, endpoints, migraciones, tests).
- [x] Cada Governance tiene uno de los 4 niveles: BAJO, MEDIO, ALTO, CRITICO.
- [x] Los changes están agrupados en FASES con nombres semánticos.
- [x] Se incluye sección "Riesgos principales" (requerimiento explícito del usuario).
- [x] C-04 cumple requisito obligatorio: crear turno evitando solapamientos por profesional AND por sillón/box con tests de overlap.
