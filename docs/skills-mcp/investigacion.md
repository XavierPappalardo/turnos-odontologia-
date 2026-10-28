# Ficha de investigación - Parte 1 (C-02 a C-04)

## 1. Necesidad detectada
El proyecto sigue el roadmap de OpenSpec con changes secuenciales. El TP pide trabajar desde C-02 hasta C-04.

- **C-02 core-models** (pendiente): Crear modelos base, migraciones, repositorios y seed mínimo. Es repetitivo y propenso a olvidar CHECKs, índices para solapamientos, `monto_centavos INTEGER`, etc.
- **C-03 auth-roles-permisos** (pendiente): Autenticación JWT + RBAC. Requiere entender actores, permisos y reglas transversales.
- **C-04 agenda-turnos-overlaps** (completo/archivado): Ya implementado, pero es fundamental entenderlo ya que es el **change mandatorio** para evitar solapamientos por profesional Y por sillón/box con transacciones `BEGIN IMMEDIATE`.

Necesidad: Una skill propia que guíe la preparación de estos changes siguiendo convenciones, y un MCP para consultar la KB (`knowledge-base/`) directamente.

## 2. Change elegido
Para esta práctica vamos a enfocar la **preparación** en **C-02 core-models** como change principal a dejar preparado con ambas incorporaciones, pero documentando todo el tramo C-02 → C-03 → C-04.

**Change foco:** `C-02 core-models`  
**Estado:** `[ ]` pendiente  
**Dependencias:** C-01 (completo/archivado)  
**Governance:** CRITICO  

Justificación: Es el siguiente en el camino crítico. Al preparar C-02 correctamente con la skill y el MCP, sentamos base para C-03 y entendemos mejor lo que C-04 requiere.

## 3. Skill creadora y diseño de la skill propia

### Skill creadora
- **Nombre:** `skill-creator` (presente en el repositorio)
- **Fuente/repositorio:** Incluida en `.agents/skill-creator/` del proyecto
- **Compatibilidad:** Compatible con el agente/orquestador del proyecto
- **Cómo instalarla/comprobarla:** Ya existe en `.agents/skill-creator/SKILL.md`. Se registra en `.atl/skill-registry.md`.
- **Uso para generar skill propia:** Seguir el flujo del skill-creator

### Skill propia a crear
- **Nombre:** `core-models-scaffolder`
- **Propósito:** Guiar la preparación/implementación de C-02 (y sentar base para C-03/C-04) siguiendo convenciones del proyecto
- **Cuándo se activa:** Al preparar/implementar C-02, o al crear entidades/migraciones relacionadas con el dominio de turnos
- **Entradas necesarias:** `knowledge-base/03-actores.md`, `04-modelos-datos.md`, `05-reglas-negocio.md`, `07-flujos.md`, `08-arquitectura.md`, `CHANGES.md`
- **Procedimiento:**
  1. Leer KB completa del tramo C-02?C-03?C-04
  2. Identificar entidades, reglas (RN-01/RN-02/RN-04/RN-05/RN-06) y actores
  3. Proponer estructura con AuditMixin, BaseRepository[T], UnitOfWork
  4. Generar migración 001 con CHECKs e índices para solapamientos `(profesional_id,inicio,fin)`, `(sillon_id,inicio,fin)`
  5. Tener en cuenta transacciones `BEGIN IMMEDIATE` para C-04
  6. Sugerir seed mínimo y tests Dado/Cuando/Entonces
- **Resultado esperado:** Artefactos alineados al roadmap, listos para OpenSpec
- **Criterios de revisión:** Respeta reglas duras, usa `monto_centavos INTEGER`, índices correctos, considera RBAC para C-03, anti-solapamiento para C-04
- **Ubicación/registro:** `.agents/core-models-scaffolder/SKILL.md`, registrado en `.atl/skill-registry.md`

## 4. Comparación de dos servidores MCP y elección justificada

### Opción 1: `@modelcontextprotocol/server-filesystem` (MCP oficial)
- **Propósito:** Acceso controlado al filesystem
- **Capacidades:** Listar, leer, escribir archivos
- **Compatibilidad:** Amplia
- **Requisitos:** Node.js/npx
- **Permisos:** Restringido a directorios autorizados
- **Credenciales:** Ningunas
- **Costo:** Gratuito

### Opción 2: `@upstash/context7-mcp`
- **Propósito:** Consultar documentación actualizada de librerías
- **Capacidades:** Buscar docs por librería/framework
- **Compatibilidad:** Amplia
- **Requisitos:** Node.js/npx (puede requerir API key)
- **Permisos:** Solo lectura
- **Credenciales:** Opcional/API key
- **Costo:** Gratuito con límites

### Elección justificada
Elegimos **`@modelcontextprotocol/server-filesystem`**. Necesitamos consultar la fundación local completa (KB, CHANGES, AGENTS, openspec) para entender la cadena C-02?C-03?C-04. No requiere credenciales y es ideal para trabajar dentro del repositorio.

### Configuración planificada (sin secretos)
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/Users/T/OneDrive/Desktop/turnos-odontologia-"]
    }
  }
}
```
- **Comprobación:** Listar archivos del repo
- **Herramienta a usar:** `list_directory` / `read_file`
- **Límites:** Solo directorio del repo, datos ficticios, sin escritura fuera de lo necesario

## 5. Archivos de la fundación a actualizar (previstos)
- `.atl/skill-registry.md` - Agregar `core-models-scaffolder`
- `AGENTS.md` y/o `CLAUDE.md` - Explicar uso de la skill
- `README.md` - Documentar MCP filesystem
- `docs/skills-mcp/investigacion.md` - Esta ficha

## 6. Fuentes con URL y fecha de consulta
- `CHANGES.md` (C-02/C-03/C-04) - local, 2026-10-28
- `knowledge-base/03-actores.md`, `04-modelos-datos.md`, `05-reglas-negocio.md`, `07-flujos.md`, `08-arquitectura.md` - local, 2026-10-28
- `AGENTS.md`, `.atl/skill-registry.md`, `.agents/skill-creator/SKILL.md` - local, 2026-10-28
- `openspec/changes/archive/` (C-01/C-04 referencia) - local, 2026-10-28
- MCP Filesystem: https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem - 2026-10-28
- Context7 MCP: https://github.com/upstash/context7 - 2026-10-28
