# Specs: C-03 auth-roles-permisos

## Escenarios verificables

### Escenario 1: Login válido
**Dado** un usuario ficticio activo con rol `recepcion`
**Cuando** hace `POST /api/auth/login` con credenciales correctas
**Entonces** recibe `200` con access token JWT y refresh en cookie `HttpOnly`, `SameSite=Lax`, `Path=/api/auth`

### Escenario 2: Credenciales inválidas
**Dado** un email inexistente o una password incorrecta
**Cuando** intenta login
**Entonces** recibe `401` con el mismo cuerpo en ambos casos, sin enumerar usuarios ni exponer PHI

### Escenario 3: RBAC
**Dado** un usuario con rol `profesional`
**Cuando** accede a `POST /api/turnos` o `PATCH /api/turnos/:id/estado`
**Entonces** recibe `403`; sin token o con token inválido recibe `401`

### Escenario 4: Rotación de refresh
**Dado** un refresh vigente
**Cuando** hace `POST /api/auth/refresh`
**Entonces** recibe un access token nuevo y una cookie de refresh distinta; el token anterior queda revocado

### Escenario 5: Reutilización de refresh
**Dado** un refresh ya rotado/revocado
**Cuando** se vuelve a presentar
**Entonces** recibe `401` y toda la familia de refresh del usuario queda revocada (blacklist)

### Escenario 6: Logout
**Dado** una sesión activa
**Cuando** llama `POST /api/auth/logout`
**Entonces** recibe `204`, la cookie se limpia y el refresh ya no puede usarse

### Escenario 7: Rate limiting
**Dado** más intentos de login que el máximo configurado en la ventana
**Cuando** intenta de nuevo
**Entonces** recibe `429 {error:"demasiados_intentos"}` con `Retry-After`

## Criterios de aceptación
- Contraseñas con scrypt; refresh almacenado solo como hash SHA-256
- `JWT_SECRET` obligatorio de al menos 32 caracteres (fail-fast)
- Seed idempotente con datos ficticios y `SEED_PASSWORD`
- Sin PHI ni secretos en logs, errores ni query params (R3)
