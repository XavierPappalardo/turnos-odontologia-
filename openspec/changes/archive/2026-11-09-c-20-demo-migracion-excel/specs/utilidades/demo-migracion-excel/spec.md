# Spec Delta

## Purpose

Define la demo instantánea con datos ficticios y la migración tabular asistida (CSV/Excel) con preview, validación, mapeo y reporte de errores para pacientes, profesionales y turnos.

## ADDED Requirements

### Requirement: Demo instantánea con datos ficticios

El sistema SHALL permitir a un usuario autorizado cargar un conjunto de datos de demostración estrictamente ficticios para uso de evaluación/onboarding. La operación SHALL ser segura e idempotente o claramente controlada para evitar duplicación/destrucción no intencional, y MUST NOT utilizar ni generar datos reales de pacientes.

#### Scenario: Usuario autorizado carga demo ficticia
- **WHEN** un usuario con rol autorizado solicita cargar la demo instantánea
- **THEN** el sistema crea o garantiza la presencia del conjunto de datos ficticios definido y responde con un resultado operativo seguro

#### Scenario: Carga repetida de demo no duplica de forma indebida
- **WHEN** un usuario autorizado solicita cargar la demo instantánea cuando los datos ficticios ya existen
- **THEN** el sistema aplica comportamiento idempotente/controlado y no crea duplicados indebidos de entidades ficticias

#### Scenario: Usuario sin autorización no carga demo
- **WHEN** un usuario sin rol autorizado intenta cargar la demo instantánea
- **THEN** el sistema rechaza la operación con error de autorización

### Requirement: Importación tabular con preview sin efectos persistentes

El sistema SHALL aceptar archivos tabulares de migración (CSV y/o Excel según formatos soportados declarados) para las entidades básicas `pacientes`, `profesionales` y `turnos`. SHALL ofrecer un modo de preview que analice el contenido, aplique mapeos/validaciones y produzca un resultado sin persistir cambios en los datos del sistema.

#### Scenario: Preview de archivo válido informa filas procesables
- **WHEN** un usuario autorizado envía un archivo tabular válido con filas de una entidad soportada para preview
- **THEN** el sistema devuelve un resumen seguro con filas válidas, filas inválidas y errores por fila sin modificar datos persistidos

#### Scenario: Preview no confirma importación
- **WHEN** se completa un preview exitoso o con errores parciales
- **THEN** ninguna fila queda persistida hasta que el usuario autorizado solicite explícitamente la confirmación de importación

#### Scenario: Formato o archivo no soportado se rechaza con seguridad
- **WHEN** un usuario autorizado envía un archivo con formato no soportado, estructura ilegible o entidad objetivo no soportada
- **THEN** el sistema rechaza la operación con error tipado y sin exponer contenido sensible en la respuesta o logs

### Requirement: Validación, mapeo y reporte de errores por fila

El sistema SHALL validar cada fila importada según la entidad objetivo (campos requeridos, tipos/formatos, referencias y reglas aplicables) y SHALL soportar mapeos de columnas/valores definidos por el flujo de importación. SHALL reportar errores por fila con motivos tipados y contexto operativo seguro para corrección.

#### Scenario: Fila inválida se reporta sin abortar todo el análisis
- **WHEN** un archivo contiene filas válidas e inválidas para la entidad objetivo
- **THEN** el sistema identifica cada fila inválida con un motivo tipado y conserva el resultado de las filas válidas en el preview/reporte, según el comportamiento definido

#### Scenario: Mapeo inválido o faltante se detecta
- **WHEN** el mapeo de columnas requerido para la entidad objetivo es incompleto o incompatible
- **THEN** el sistema rechaza o marca la importación como inválida con error tipado antes de persistir datos

#### Scenario: Errores de turno inválido respetan integridad y reglas de agenda
- **WHEN** una fila de `turno` referencia entidades inexistentes, tiene fechas/estado inválidos o viola reglas de integridad/agenda aplicables al persistir
- **THEN** el sistema la rechaza con motivo tipado y MUST NOT persistir un turno inválido

### Requirement: Confirmación de importación con controles transaccionales

El sistema SHALL persistir únicamente los datos aceptados por la importación confirmada, aplicando controles transaccionales/atómicos apropiados al alcance definido para evitar estados parciales indebidos. SHALL devolver un reporte final con conteos y errores/filas rechazadas.

#### Scenario: Confirmación persiste filas válidas aceptadas
- **WHEN** un usuario autorizado confirma la importación tras un preview/análisis con filas válidas
- **THEN** el sistema persiste las filas aceptadas, respeta integridad referencial y devuelve un reporte final seguro con resultado por operación

#### Scenario: Fallo de validación en confirmación no corrompe datos existentes
- **WHEN** la confirmación encuentra filas inválidas o conflictos que impiden su persistencia segura
- **THEN** el sistema rechaza o aísla esas filas según la regla definida, reporta el resultado tipado y no corrompe datos previamente válidos

### Requirement: Autorización, privacidad y seguridad operativa de la importación

Las operaciones de demo e importación SHALL estar restringidas a roles administrativos/autorizados. El sistema MUST evitar PHI y contenido sensible importado en logs, stack traces y mensajes de error; las respuestas operativas SHALL usar motivos tipados y contexto mínimo necesario. Los datos de demo MUST ser ficticios.

#### Scenario: Usuario sin rol autorizado intenta importar o previsualizar
- **WHEN** un usuario sin rol autorizado intenta ejecutar demo, preview o confirmación de importación
- **THEN** el sistema rechaza la operación con error de autorización sin exponer contenido del archivo

#### Scenario: Logs y errores no exponen contenido sensible importado
- **WHEN** ocurre un error de parseo, validación o persistencia durante la importación
- **THEN** los logs y respuestas contienen códigos/motivos tipados y referencias seguras, sin volcar filas completas con PHI ni datos sensibles innecesarios
