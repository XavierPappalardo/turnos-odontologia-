# Spec — platform/foundation

## Purpose

Establece el cimiento observable del proyecto: health check, configuración por entorno, bootstrap de base de datos con migraciones, logging estructurado sin datos sensibles, manejo centralizado de errores tipados, y los contratos de scripts/build de backend y frontend sobre los que se apoyan todos los changes del MVP.

## Requirements

### Requirement: Health check endpoint

El sistema SHALL exponer `GET /api/health` sin requerir autenticación, devolviendo `200` con cuerpo `{"status":"ok"}`, para que orquestadores, monitoreo y CI puedan verificar que el servicio está arriba.

#### Scenario: Health check responde OK

- **WHEN** se invoca `GET /api/health` sobre una instancia iniciada
- **THEN** el sistema responde `200` con `{"status":"ok"}`

### Requirement: Configuración por variables de entorno

El sistema SHALL cargar toda la configuración de ejecución (puerto, ruta de base de datos, entorno y cualquier secreto futuro) desde variables de entorno. SHALL NOT hardcodear secretos ni credenciales y SHALL NOT incluir valores secretos reales en `.env.example`. Cuando falte una variable requerida, el sistema SHALL fallar de forma temprana con un error descriptivo en lugar de asumir un default silencioso.

#### Scenario: Variable requerida ausente falla temprano

- **WHEN** se inicia la aplicación sin una variable de entorno requerida
- **THEN** el arranque falla con un error descriptivo que nombra la variable faltante y no usa un default silencioso

#### Scenario: Ejemplo de entorno sin secretos

- **WHEN** se inspecciona `.env.example` de cada subproyecto
- **THEN** contiene solo nombres de variables y valores de ejemplo no secretos, sin credenciales ni tokens reales

### Requirement: Bootstrap de base de datos y runner de migraciones

El sistema SHALL abrir la base SQLite con integridad referencial habilitada y aplicar las migraciones en orden ascendente exactamente una vez, incluida la migración base (001) que crea las tablas núcleo. Re-ejecutar el arranque sobre una base ya migrada SHALL ser idempotente: no SHALL fallar ni duplicar el esquema.

#### Scenario: Base nueva aplica la migración base

- **WHEN** se abre una base de datos nueva (archivo o en memoria) mediante el bootstrap
- **THEN** la migración base (001) queda aplicada y las tablas núcleo existen

#### Scenario: Re-arranque idempotente

- **WHEN** el bootstrap se ejecuta dos veces sobre la misma base
- **THEN** la segunda ejecución no falla y el esquema permanece consistente (sin duplicar tablas)

### Requirement: Logging estructurado sin datos sensibles

El sistema SHALL emitir entradas de log estructuradas (parseables por máquina) para arranque, requests y errores. Los logs SHALL NOT contener PHI (nombres, DNI, historia clínica, teléfonos), ni secretos (tokens, credenciales, valores completos de `.env`), ni payloads sensibles completos de las solicitudes.

#### Scenario: Logs excluyen datos sensibles

- **WHEN** se procesa una solicitud que involucra datos de un paciente ficticio y un fallo
- **THEN** los logs emitidos no contienen nombres de pacientes, DNI, teléfonos, historia clínica ni secretos; solo identificadores opacos

### Requirement: Manejo centralizado de errores tipados

El sistema SHALL devolver los fallos como JSON con un código de error estable. Las validaciones y fallos conocidos SHALL mapear a `4xx`; los fallos inesperados SHALL mapear a un `500` genérico `{"error":"interno"}` sin stack traces, rutas internas, SQL ni PHI.

#### Scenario: Error de validación mapea a 4xx

- **WHEN** una solicitud incumple una validación conocida del cimiento
- **THEN** el sistema responde con el código `4xx` correspondiente y un cuerpo JSON con código de error, sin exponer detalles internos

#### Scenario: Error inesperado devuelve 500 genérico

- **WHEN** ocurre un fallo no controlado al procesar una solicitud
- **THEN** el sistema responde `500` con `{"error":"interno"}` y no incluye stack trace, rutas de archivos, SQL ni PHI

### Requirement: Scripts de desarrollo y verificación

Cada subproyecto SHALL exponer scripts para verificar tipos (`typecheck` ejecutando `tsc --noEmit`), ejecutar tests (`test`) y construir (`build`). El repositorio SHALL definir un flujo de CI mínimo que instale dependencias, ejecute la verificación de tipos y corra las suites de test de backend y frontend.

#### Scenario: Scripts de verificación disponibles

- **WHEN** se inspecciona `package.json` de backend y frontend
- **THEN** ambos exponen los scripts `typecheck`, `test` y `build`

#### Scenario: CI corre typecheck y tests

- **WHEN** se ejecuta el flujo de CI sobre un push
- **THEN** instala dependencias, corre la verificación de tipos y corre las suites de test de backend y frontend

### Requirement: Contratos de build y desarrollo del frontend

El frontend SHALL construirse con React + Vite + TypeScript (stack aprobado en este change) y SHALL exponer los scripts `dev` (servidor de desarrollo local), `build` (bundle estático de producción), `preview`, `typecheck`, `lint` y `test`. La configuración expuesta al navegador SHALL limitarse a variables con prefijo `VITE_` y SHALL NOT incluir secretos.

#### Scenario: Servidor de desarrollo inicia

- **WHEN** se ejecuta el script `dev` del frontend
- **THEN** se levanta un servidor de desarrollo local que sirve la aplicación

#### Scenario: Build de producción genera assets estáticos

- **WHEN** se ejecuta el script `build` del frontend
- **THEN** se generan los assets estáticos de producción sin errores de tipo

#### Scenario: Solo configuración pública VITE_*

- **WHEN** se configura el frontend por variables de entorno
- **THEN** solo las variables `VITE_*` se exponen al navegador y ninguna contiene secretos
