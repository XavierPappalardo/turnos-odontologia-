# Spec Delta

## Purpose

Permite que un paciente acceda por link o token opaco a un portal básico para consultar sus propios turnos, presupuestos y documentos disponibles, y para autogestionar acciones permitidas sobre sus turnos con privacidad y controles de seguridad.

## ADDED Requirements

### Requirement: Acceso al portal por token opaco con scoping por paciente
El sistema SHALL permitir acceso al portal únicamente mediante un token opaco de acceso a portal, emitido/gestionado por el sistema, con validez temporal configurable y límites de uso razonables. El token SHALL estar asociado a un único `paciente_id` y MUST NOT exponer PHI en su valor. Toda operación del portal SHALL ejecutarse en el contexto de ese paciente; el sistema MUST rechazar con error tipado (sin PHI) tokens ausentes, inválidos, expirados o revocados.

#### Scenario: Acceso válido limitado al paciente propietario
- **WHEN** un cliente presenta un token de portal válido asociado a un paciente ficticio
- **THEN** el sistema autoriza las operaciones de lectura/acción del portal solo para los recursos de ese `paciente_id`

#### Scenario: Token inválido o expirado
- **WHEN** un cliente presenta un token de portal inexistente, malformado o expirado
- **THEN** el sistema responde con error tipado sin PHI y no devuelve datos de turnos, presupuestos ni documentos

#### Scenario: Intento de acceso a recurso de otro paciente
- **WHEN** una operación del portal referencia un recurso cuyo `paciente_id` no coincide con el contexto del token válido
- **THEN** el sistema rechaza la operación con error tipado sin PHI y no filtra existencia de datos ajenos

### Requirement: Consulta de turnos propios
El sistema SHALL exponer al paciente, dentro del portal autenticado por token, una vista de sus turnos con información operativa necesaria (identificadores opacos/referencias seguras, estado, fecha/hora, profesional/sillón/prestación en forma segura según contrato) sin incluir PHI innecesaria en logs ni exponer datos de otros pacientes.

#### Scenario: Listado de turnos del paciente
- **WHEN** el paciente accede a la sección "mis turnos" con token válido
- **THEN** el sistema devuelve únicamente turnos pertenecientes a ese paciente, ordenados de forma predecible, con estados vigentes del dominio

#### Scenario: Paciente sin turnos
- **WHEN** el paciente accede a "mis turnos" y no tiene turnos registrados
- **THEN** el sistema devuelve un resultado vacío/estado seguro sin error

### Requirement: Consulta de presupuestos propios
El sistema SHALL exponer al paciente, dentro del portal autenticado por token, sus presupuestos con estado y montos presentados de forma consistente con el dominio (ARS en representación segura definida por el contrato/API), sin permitir edición clínica/administrativa desde el portal.

#### Scenario: Listado de presupuestos del paciente
- **WHEN** el paciente accede a la sección "mis presupuestos" con token válido
- **THEN** el sistema devuelve únicamente presupuestos pertenecientes a ese paciente

#### Scenario: Operación de escritura sobre presupuesto desde portal
- **WHEN** un cliente del portal intenta crear, editar, eliminar o transicionar un presupuesto
- **THEN** el sistema rechaza la operación con error tipado y no modifica el presupuesto

### Requirement: Sección de documentos con comportamiento seguro en MVP
El sistema SHALL presentar una sección "documentos" en el portal. En ausencia de un modelo/almacenamiento documental dedicado en el MVP, la sección SHALL comportarse de forma segura (lista vacía o referencias explícitamente disponibles) sin exponer archivos clínicos/PHI ni rutas internas inseguras.

#### Scenario: Sección documentos sin repositorio documental
- **WHEN** el paciente accede a "documentos" y no existen documentos publicables en el alcance del MVP
- **THEN** el sistema muestra/retorna un estado vacío seguro sin error y sin PHI

### Requirement: Autogestión de turnos propios con validaciones vigentes
El sistema SHALL permitir al paciente confirmar, cancelar o reprogramar solo sus turnos mediante el portal, aplicando las mismas reglas de negocio y transiciones de estado vigentes que la agenda (incluyendo anticipación mínima y validación de disponibilidad/anti-solapamiento/bloqueos para reprogramación cuando corresponda). Las mutaciones SHALL ejecutarse con la semántica transaccional requerida para evitar inconsistencias o solapes.

#### Scenario: Confirmación válida de turno propio
- **WHEN** el paciente solicita confirmar un turno propio en un estado que permite la transición
- **THEN** el sistema actualiza el estado según la máquina de estados vigente y devuelve resultado seguro

#### Scenario: Cancelación fuera de regla
- **WHEN** el paciente solicita cancelar un turno propio sin cumplir la anticipación mínima u otra regla aplicable
- **THEN** el sistema rechaza la acción con error tipado sin PHI y no cambia el estado

#### Scenario: Reprogramación con conflicto
- **WHEN** el paciente solicita reprogramar un turno propio a un horario que genera solape o viola bloqueos/disponibilidad
- **THEN** el sistema rechaza la reprogramación, no persiste un cambio parcial y devuelve error tipado sin PHI

#### Scenario: Acción sobre turno ajeno
- **WHEN** un token válido de un paciente intenta confirmar, cancelar o reprogramar un turno de otro paciente
- **THEN** el sistema rechaza la acción con error tipado sin PHI

### Requirement: UI básica responsive y manejo seguro de errores
El portal SHALL ofrecer una interfaz web básica responsive para las secciones y acciones definidas, accesible mediante el flujo de link/token. Errores de validación, autorización, conflicto y límites SHALL presentarse con mensajes seguros (sin PHI, sin secretos, sin detalles internos) y la API/operación SHALL aplicar rate limiting y controles equivalentes a otros flujos públicos del sistema.

#### Scenario: Navegación responsive con token válido
- **WHEN** un usuario abre el portal con un token válido en un viewport móvil o de escritorio
- **THEN** la interfaz permite acceder a turnos, presupuestos, documentos y acciones disponibles sin requerir conocimientos técnicos

#### Scenario: Límite de tasa excedido
- **WHEN** un cliente excede el límite de solicitudes configurado para endpoints del portal
- **THEN** el sistema responde con control de tasa apropiado y sin exponer PHI ni secretos
