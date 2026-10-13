# Etapa 7 — Memoria del agente (Engram, breve)

Recupera la sesión de Discovery sin que el usuario reexplique el contexto.

## Qué hace

1. Lista las sesiones guardadas en la base persistente (`opencode.db`).
2. Recupera los mensajes de la sesión del proyecto (etapa 2 Discovery).
3. Extrae decisiones y hallazgos (convenciones de verificación, criterio `No evidenciado`, ajustes finales).

Evidencia versionable relacionada: `discovery/discovery.md`, `CHANGES.md`, `openspec/changes/archive/`.

## Cómo reproducirlo

```bash
python docs/scripts/consulta_recuperacion.py
# Opcional: SESSION_ID=<id> OPENCODE_DB=<ruta> python docs/scripts/consulta_recuperacion.py
```

El script autodetecta la sesión del proyecto por título/directorio si `SESSION_ID` no está definido o no existe en la máquina.
