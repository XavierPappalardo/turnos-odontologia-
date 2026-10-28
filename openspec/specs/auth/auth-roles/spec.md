# Spec — auth/auth-roles

## Purpose

Autentica usuarios internos y aplica RBAC por rol (`recepcion`, `profesional`, `administracion`), con sesión de access token JWT y refresh rotativo en cookie HttpOnly, sin exponer PHI ni secretos en respuestas o logs.

## Requirements

### Requirement: Login con credenciales válidas

El sistema SHALL exponer `POST /api/auth/login` que valida email+password contra `usuario`/`usuario_rol` y responde `200` con `access_token`, `token_type:"Bearer"`, `expires_in` y `user`; SHALL emitir el refresh en cookie `refresh_token` con `HttpOnly`, `SameSite=Lax`, `Path=/api/auth`, `Secure` cuando `NODE_ENV=production` y `Max-Age` igual al TTL configurado.

#### Scenario: Login válido emite access + refresh

- **WHEN** un usuario activo envía credenciales correctas
- **THEN** el sistema responde `200` con un access token verificable (claims `sub`, `tenant_id`, `roles`, `email`, `jti`, `type`, `iat`, `exp`) y una cookie de refresh HttpOnly/Lax

#### Scenario: Credenciales inválidas no enumeran usuarios

- **WHEN** se envía un email inexistente o una password incorrecta
- **THEN** el sistema responde `401` con el mismo cuerpo en ambos casos y sin email, nombre ni hash en la respuesta

### Requirement: Contraseñas y tokens seguros sin dependencias externas

El sistema SHALL almacenar contraseñas con scrypt (salt aleatorio + comparación en tiempo constante) y SHALL firmar JWT HS256 con `JWT_SECRET` de al menos 32 caracteres; SHALL almacenar solo el hash SHA-256 del refresh token.

#### Scenario: Secreto faltante o corto falla al arrancar

- **WHEN** `JWT_SECRET` no está definido o tiene menos de 32 caracteres
- **THEN** la carga de configuración falla con `ConfigError` nombrando `JWT_SECRET`

### Requirement: Rotación y blacklist de refresh tokens

El sistema SHALL rotar el refresh en cada `POST /api/auth/refresh` dentro de una transacción `BEGIN IMMEDIATE`, revocando el token usado y registrando el reemplazo. Reutilizar un refresh ya revocado SHALL responder `401` y revocar toda la familia de tokens del usuario.

#### Scenario: Refresh válido rota el token

- **WHEN** se presenta un refresh vigente en la cookie
- **THEN** el sistema responde `200` con un nuevo access token y una nueva cookie de refresh distinta

#### Scenario: Reutilización de refresh revoca la familia

- **WHEN** se presenta un refresh ya rotado o revocado
- **THEN** el sistema responde `401` y el resto de la familia deja de ser válido

#### Scenario: Logout revoca el refresh

- **WHEN** un usuario autenticado llama `POST /api/auth/logout`
- **THEN** el sistema responde `204`, limpia la cookie y el refresh deja de poder usarse

### Requirement: RBAC por rol

El sistema SHALL exponer `GET /api/auth/me` y SHALL proteger las rutas internas con Bearer token. `POST /api/turnos` y `PATCH /api/turnos/:id/estado` SHALL aceptar solo roles `recepcion` o `administracion`; un rol `profesional` SHALL recibir `403`; una petición sin token o con token inválido/expirado SHALL recibir `401`.

#### Scenario: Acceso autorizado

- **WHEN** recepción o administración accede a una ruta de agenda con un access token válido
- **THEN** la operación se ejecuta (no `401`/`403`)

#### Scenario: Acceso denegado sin filtrar información

- **WHEN** un rol no autorizado o un token inválido accede a una ruta protegida
- **THEN** el sistema responde `403` o `401` respectivamente, sin PHI ni detalles del token

### Requirement: Rate limiting de login

El sistema SHALL limitar los intentos de login por IP+email según `LOGIN_RATE_LIMIT_MAX` y `LOGIN_RATE_LIMIT_WINDOW_SECONDS` (default 5/60 s) y SHALL responder `429` con `Retry-After` al superar el límite.

#### Scenario: Demasiados intentos

- **WHEN** se superan los intentos permitidos en la ventana
- **THEN** el sistema responde `429 {error:"demasiados_intentos"}` con cabecera `Retry-After`

### Requirement: Seed de usuarios ficticios

El sistema SHALL proveer un seed idempotente (`npm run seed`) que crea usuarios ficticios para los tres roles usando `SEED_PASSWORD`; SHALL NOT contener contraseñas reales ni datos de pacientes reales.

#### Scenario: Seed repetible

- **WHEN** se ejecuta el seed dos veces con la misma base
- **THEN** no se duplican usuarios y las credenciales ficticias permiten login
