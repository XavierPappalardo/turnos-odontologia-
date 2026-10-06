# 03 — Actores, roles y permisos

**Fecha:** 2026-10-06
**Fuente base:** `discovery/discovery.md`, punto 2 (usuarios/roles) y caso de uso 10; Anexo A (roles en DentalSoft, AgendaPro, Ninsaúde).

Todos los datos de personas en este documento son ficticios. No se incluyen datos reales de pacientes.

## Actores

### 1. Paciente
- Reserva turno online 24/7 sin llamar ni escribir (casos de uso 1–2).
- Confirma, cancela o reprograma desde WhatsApp o link.
- Paga online o en consultorio.
- Accede a turnos, presupuestos y documentos en el portal del paciente (fase 2 temprana).
- Permisos: solo lectura y gestión de sus propios turnos y documentos. Sin acceso a agendas ajenas ni a caja.

### 2. Recepción / Administración
- Gestiona la agenda diaria/semanal de todos los profesionales y sillones: bloqueos, sobreturnos, lista de espera (caso de uso 3).
- Envía y supervisa confirmaciones y recordatorios automáticos (caso de uso 4).
- Cobra (efectivo, tarjeta, transferencia, Mercado Pago, obra social), cierra caja y persigue deudas (caso de uso 6).
- Liquida obras sociales y comisiones (caso de uso 7).
- Permisos: crear/editar/cancelar turnos, gestionar bloqueos y sobreturnos, cobrar y anular con traza, ver reportes operativos. No configura comisiones ni planes de OS (solo administración/dueño).

### 3. Odontólogo / Profesional
- Ve su agenda del día, registra historia clínica y odontograma, arma presupuestos y planes de tratamiento, emite recetas (caso de uso 5).
- En el segmento independiente (1 profesional) concentra los roles de profesional y recepción básica.
- Permisos: ver y gestionar sus propios turnos, editar HC/odontograma de sus pacientes, crear presupuestos. No accede a caja global ni a comisiones de otros profesionales.

### 4. Dueño / Gestor de clínica
- Mira ocupación, facturación, rentabilidad por tratamiento/profesional y ausentismo; recupera inactivos con campañas (caso de uso 8).
- Define precios ARS, comisiones, anticipación mínima y políticas de cancelación.
- Permisos: acceso total a reportes y configuración; exportación de datos dentro de los 30 días posteriores a la baja como estándar contractual mínimo observado (https://dentalsoft.com.ar/terminos — 2026-10-06).

### 5. Institución (círculo / colegio)
- Valida prácticas, audita y liquida a prestadores (caso de uso 10; rol cubierto solo por DentalTec; https://web.dentaltec.com.ar/ — 2026-10-06).
- Alcance: fuera del MVP; eventual segundo producto / integración. Sin permisos en el SaaS de consultorio salvo reportes de auditoría pactados.

## Matriz de permisos (resumen)

| Función | Paciente | Recepción | Odontólogo | Dueño |
|---|---|---|---|---|
| Reservar / reprogramar propio turno | Sí | Sí | Propios | Sí |
| Bloqueos y sobreturnos | No | Sí | No | Sí |
| HC / odontograma | Propia (lectura, fase 2) | No edita | Sus pacientes | Lectura |
| Cobro y cierre caja | Paga | Cobra/cierra | No | Supervisa |
| Liquidar OS / comisiones | No | Opera | Vista propia | Configura |
| Reportes y configuración | No | Operativos | Propios | Total |

Seguridad y cumplimiento (Ley 26.529, Ley 25.326, HCE): "No evidenciado" en ningún competidor local (Discovery punto 10 — 2026-10-06); el control de acceso, cifrado, backup y consentimientos se diseñan desde el día 1 con asesoría legal.
