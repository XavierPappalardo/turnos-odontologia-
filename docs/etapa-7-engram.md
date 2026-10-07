# Etapa 7 — Memoria del agente (Engram)

> Evidencia de la memoria persistente del proyecto: qué quedó guardado, la consulta real de recuperación y por qué evita que el agente arranque de cero.

## 1. Qué quedó guardado sobre este proyecto

La memoria persistente (base de sesiones de opencode) conserva, entre 21 sesiones y 955 mensajes de esta máquina, la sesión de trabajo del proyecto: **"Verificación fuentes etapa 2 Discovery"** (103 mensajes). De ella se recuperan las siguientes decisiones, hallazgos y convenciones que se habían definido en sesiones anteriores:

| Tipo | Contenido guardado | Origen verificable |
|---|---|---|
| Convención | El entregable de la etapa 2 exige las secciones 7. Verificación y 8. Referencias, después del Anexo D | Informe `discovery/discovery.md` §7-§8 |
| Convención | Distinguir siempre `funcionalidad comprobada` vs `afirmación comercial`; celdas sin respaldo = `No evidenciado` | `discovery/discovery.md` §7.1 |
| Convención | Verificación manual de 5 fuentes, una por tipo exigido (sitio oficial, funcionalidades, legal, precios, marketplace) consignando fecha de consulta (2026-10-06) | `discovery/discovery.md` §7.1-§7.6 |
| Hallazgo | Fresha: los 20 mensajes gratuitos son combinados SMS + WhatsApp (ajuste de precisión) | `discovery/sources/fresha.md` y §7.5 |
| Hallazgo | AgendaPro/Capterra: prueba gratuita de 7 días con exigencia de método de pago; sube de afirmación comercial a comprobada por acceso propio | `discovery/sources/agendapro.md:48` y §7.6 |
| Hallazgo | Precios AR de AgendaPro (ARS 13.900–314.900, WhatsApp +$7.900) se mantienen como verificados por tercero | `discovery/sources/agendapro.md:61` |
| Decisión | Estructura del repositorio y de cada informe; 18 notas de fuente en `discovery/sources/` | `.active-orchestrator-state.json` |
| Reglas del agente | Reglas del proyecto en `AGENTS.md` / `CLAUDE.md` (stack, KB, skills, PHI) | `AGENTS.md` |

Una vez implementado el change (etapa 6), la memoria queda además formalizada en los archivos versionables del proyecto: `CHANGES.md`, `openspec/changes/archive/2026-10-06-c-04-agenda-turnos-overlaps/` (proposal, design, tasks, specs) y `backend/`.

## 2. Consulta real de recuperación de contexto

La consulta que recupera la memoria de la sesión anterior se hace sobre la base persistente de sesiones (`opencode.db`):

```sql
-- 1) ¿Qué sesiones anteriores hay y cuál pertenece a este proyecto?
SELECT id, title, directory, time_created, time_updated
  FROM session
 ORDER BY time_updated DESC;
-- → "Verificación fuentes etapa 2 Discovery" · C:/Users/T/OneDrive/Documentos/Default Project

-- 2) Recuperar el contexto (mensajes) de esa sesión del proyecto
SELECT id, data
  FROM message
 WHERE session_id = 'ses_eee1680f2ffeKNIkcW4lCKqD95'
 ORDER BY time_created;

-- 3) Recuperar las decisiones/hallazgos por contenido (partes de texto)
SELECT data
  FROM part
 WHERE session_id = 'ses_eee1680f2ffeKNIkcW4lCKqD95'
   AND json_extract(data, '$.type') = 'text';
```

Resultado de la recuperación (resumen del contexto que una nueva sesión recibe sin que el usuario repita nada): el proyecto es un sistema de turnos odontológicos para el mercado argentino; el informe de Discovery estaba completo salvo la sección de verificación; las 5 fuentes a verificar, su método y el criterio de `No evidenciado`; los dos ajustes finales (Fresha SMS+WA y AgendaPro trial 7 días con método de pago) y el estado de la entrega (informe en `discovery/informe-discovery.pdf`).

Para reproducir la consulta y mostrarla en el video, correr:

```bash
python docs/scripts/consulta_recuperacion.py
```

## 3. Por qué esto evita que el agente arranque de cero

Sin memoria persistente, cada sesión empieza sin saber qué producto se construye, qué se decidió ni qué falta. Con la memoria, una sesión nueva retoma el estado exacto: la etapa en curso, las decisiones ya tomadas, los archivos involucrados y los ajustes pendientes. En este proyecto, la prueba es que la sesión actual recuperó el trabajo de la etapa 2 (verificación de fuentes) y del change de la etapa 6 (C-04 archivado con 20/20 tests en verde) sin que el usuario tuviera que reexplicar el contexto.

La misma idea se refuerza con la memoria **versionable** del repositorio: `CHANGES.md` (roadmap), la KB, el estado de orquestación (`.active-orchestrator-state.json`) y el archive de OpenSpec, que cualquier integrante o agente puede leer en una sesión distinta.