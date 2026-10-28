# turnos-odontologia-
Integrantes: Xavier Pappalardo, Nicolás Ibáñez, Lautaro Gómez Cánovas, Benjamín Arrollo, Maximiliano Reinoso y Martín Sisterna.

## Integración MCP (TP - Parte 2)
Se documenta la configuración del servidor MCP `@modelcontextprotocol/server-filesystem` para consultar la fundación del proyecto.

### Configuración (ejemplo, sin secretos)
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

### Pasos
1. Configurar en el cliente MCP usado (según entorno). Si es configuración global, indicar ubicación.
2. Verificar conexión listando archivos del repo.
3. Usar herramienta `list_directory`/`read_file` para consultar `knowledge-base/`, `CHANGES.md`, `AGENTS.md`.

### Límites
- Restringido al directorio del repositorio
- Trabajar con datos ficticios
- Sin credenciales necesarias
