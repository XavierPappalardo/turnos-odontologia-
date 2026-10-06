# Skill Registry

**Delegator use only.** Any agent that launches sub-agents reads this registry to resolve compact rules, then injects them directly into sub-agent prompts. Sub-agents do NOT read this registry or individual SKILL.md files.

See `_shared/skill-resolver.md` for the full resolution protocol.

## User Skills

| Trigger | Skill | Path |
|---------|-------|------|
| Crear servidores Node.js, REST APIs, GraphQL backends o microservicios; middleware, error handling, auth, integración de BD | nodejs-backend-patterns | `C:\Users\Admin\.agents\skills\nodejs-backend-patterns\SKILL.md` |
| Escribir tests, mocks, coverage, filtering o fixtures con Vitest (Jest-compatible, Vite-native) | vitest | `C:\Users\Admin\.agents\skills\vitest\SKILL.md` |
| El código toca datos de pacientes/clinicianos, se implementan controles de acceso HIPAA/GDPR, o se audita el sistema por exposición de datos | healthcare-phi-compliance | `C:\Users\Admin\.agents\skills\healthcare-phi-compliance\SKILL.md` |
| Implementar lógica de tipos compleja, crear utilidades de tipos reutilizables, o garantizar type safety en TypeScript | typescript-advanced-types | `C:\Users\Admin\.agents\skills\typescript-advanced-types\SKILL.md` |
| "openspec propose" / "opsx propose" — describir qué construir y obtener proposal + specs + design + tasks completos | openspec-propose | `C:\Users\Admin\Documents\facu 3\metodología\SWWSW\turnos-odontologia-\.opencode\skills\openspec-propose\SKILL.md` |
| "openspec apply" / "opsx apply" / "openspec implement" — empezar/continuar implementación y trabajar tasks | openspec-apply-change | `C:\Users\Admin\Documents\facu 3\metodología\SWWSW\turnos-odontologia-\.opencode\skills\openspec-apply-change\SKILL.md` |
| "openspec archive" / "opsx archive" — finalizar y archivar un change completado | openspec-archive-change | `C:\Users\Admin\Documents\facu 3\metodología\SWWSW\turnos-odontologia-\.opencode\skills\openspec-archive-change\SKILL.md` |
| "openspec explore" / "opsx explore" — pensar en ideas/problemas/requisitos antes o durante un change | openspec-explore | `C:\Users\Admin\Documents\facu 3\metodología\SWWSW\turnos-odontologia-\.opencode\skills\openspec-explore\SKILL.md` |
| "openspec sync" / "opsx sync" — sincronizar delta specs a main specs sin archivar el change | openspec-sync-specs | `C:\Users\Admin\Documents\facu 3\metodología\SWWSW\turnos-odontologia-\.opencode\skills\openspec-sync-specs\SKILL.md` |
| "openspec update change" / "opsx update" — revisar los artifacts de planificación de un change (nunca edita código) | openspec-update-change | `C:\Users\Admin\Documents\facu 3\metodología\SWWSW\turnos-odontologia-\.opencode\skills\openspec-update-change\SKILL.md` |
| /active-orchestrator:init, :kb, :rules, :discovery, :openspec, :devops, :find-skill — arrancar un proyecto nuevo con el flujo de fundación SDD/OpenSpec | active-orchestrator | `C:\Users\Admin\.config\opencode\skills\active-orchestrator\SKILL.md` |
| Cuando el usuario pide crear/generar/actualizar AGENTS.md o CLAUDE.md, "armar las reglas del proyecto", "instrucciones para los agentes", "generar claude.md", o tras correr kb-creator + roadmap-generator | agents-md-generator | `C:\Users\Admin\.config\opencode\skills\agent-instruction\SKILL.md` |
| Cuando jr-orchestrator despache la fase discovery del flujo de fundación, o el usuario quiera investigar el mercado/qué construir antes de tener claridad | discovery-research | `C:\Users\Admin\.config\opencode\skills\discovery-research\SKILL.md` |
| "how do I do X", "find a skill for X", "is there a skill that can...", interés en extender capacidades instalando skills | find-skills | `C:\Users\Admin\.config\opencode\skills\find-skill\SKILL.md` |
| Crear/build/generar una knowledge base, documentar proyecto desde .txt/.docx/.pdf, "armar base de conocimiento" / "crear KB" / "documentar proyecto" | kb-creator | `C:\Users\Admin\.config\opencode\skills\kb-creator\SKILL.md` |
| Crear/build/regenerar/actualizar CHANGES.md, roadmap, mapa de changes, plan de implementación; "armar CHANGES", "armar roadmap", "índice de changes" | roadmap-generator | `C:\Users\Admin\.config\opencode\skills\roadmap-generator\SKILL.md` |
| Crear una skill desde cero, editar/optimizar una existente, correr evals, benchmark con variance analysis, optimizar la description para mejor triggering | skill-creator | `C:\Users\Admin\.config\opencode\skills\skill-creator\SKILL.md` |
| Investigar/scrapear un competidor a partir de una URL, o cuando discovery-research la invoque como sub-skill durante Discovery | web-scraper | `C:\Users\Admin\.config\opencode\skills\web-scraper\SKILL.md` |

> Dedupe: los 6 skills openspec-* existen también en `C:\Users\Admin\.agents\skills\` — se conserva la versión **project-level** (`.opencode\skills\`). `skill-registry` se omite (es esta skill). `agent-instruction` (dir) tiene frontmatter `name: agents-md-generator`; `find-skill` (dir) tiene `name: find-skills`.

## Compact Rules

Pre-digested rules per skill. Delegators copy matching blocks into sub-agent prompts as `## Project Standards (auto-resolved)`.

### nodejs-backend-patterns
- TypeScript obligatorio en todo el backend; validar input con Zod/Joi en cada frontera de ruta
- Custom error classes + middleware centralizado de errores; nunca filtrar stack traces al cliente
- Secrets solo vía variables de entorno; nunca hardcodear
- Logging estructurado (Pino/Winston); nunca loguear payloads sensibles
- Producción: rate limiting, compresión, health checks, graceful shutdown, HTTPS, CORS sin `*`
- Connection pooling para bases de datos; dependency injection para testabilidad
- Patrones detallados en `references/details.md` — leer cuando el resumen no alcance
- Testing: delegar en la skill javascript-testing-patterns

### vitest
- API compatible con Jest (`test/it`, `describe`, `expect`) — ESM/TS/JSX nativos sin configuración
- Mocks con `vi` (vi.fn, vi.spyOn, vi.mock, vi.useFakeTimers); setup compartido con `vi.hoisted`
- Hooks: beforeEach/afterEach/beforeAll/afterAll/aroundEach
- Coverage integrado con providers V8 o Istanbul
- Filtrado por nombre/archivo/tag; modificadores `.skip` / `.only` / `.concurrent`
- Type testing con `expectTypeOf` / `assertType`
- Fixtures vía `test.extend` (test context), no estado global mutable
- Config compartida con Vite (`defineConfig`); workspaces multiproyecto con "projects"
- Basado en Vitest 5.0.1 — consultar `references/` (core-*, features-*, advanced-) para detalle

### healthcare-phi-compliance
- Clasificar primero: datos identificables del paciente = PHI; datos de clinicianos/financieros = PII
- NUNCA PHI en: mensajes de error, stack traces, console.log, query/path params de URLs, localStorage/sessionStorage
- Loguear solo UUIDs opacos internos — nunca números de historia clínica, IDs nacionales ni nombres
- Toda lectura/creación/edición/impresión/exportación de PHI genera entrada de audit trail (timestamp, user, recurso, cambios, IP, sesión)
- Tablas de audit: insert-only — UPDATE/DELETE prohibidos para todos los roles
- Aislamiento por instalación/rol: cada usuario solo ve las filas de su facility (SQLite no tiene RLS → scoping en queries + middleware de la app)
- Nunca claves privilegiadas/service-role en código de cliente
- Taggear columnas PHI/PII a nivel de schema (`COMMENT ON COLUMN … 'PHI: …'`)
- Errores al cliente genéricos ("Record not found"); el detalle se loguea server-side
- Checklist pre-deploy: auth en todos los endpoints PHI, timeout de sesión, aislamiento cross-tenant verificado

### typescript-advanced-types
- `unknown` sobre `any`; strict mode siempre; type guards, nunca type assertions
- `interface` para formas de objeto (mejores errores); `type` para unions y utility types
- Conditional types distribuyen sobre parámetros desnudos — envolver en tupla `[T]` para desactivar
- Preferir `infer` + patrones ReturnType/Parameters sobre extracciones manuales
- Mapped types + key remapping (`as`) para tipos derivados; Pick/Omit para acotar
- Template literal types para patrones de string; limitar profundidad de recursión
- Discriminated unions para modelar estados; nunca booleans opcionales como pseudo-union
- `const` assertions para preservar literales; documentar tipos complejos con JSDoc
- Built-ins: Partial/Required/Readonly/Pick/Omit/Exclude/Extract/NonNullable/Record
- Testear tipos con helpers AssertEqual/expectTypeOf
- Evitar condicionales anidadas muy profundas — frenan la compilación

### openspec-propose
- Borde de planificación: crear artifacts (proposal, specs, design, tasks) y NUNCA editar código del proyecto; parar tras presentar y esperar nuevo pedido para aplicar
- Primero `openspec context --json`; si `no_openspec_root` seguir el project check — nunca correr `openspec init` ni crear `openspec/` a mano salvo pedido explícito
- Si el usuario nombra un store, append `--store <id>` a todos los comandos openspec de lectura/escritura; mantenerlo sticky
- Derivar nombre kebab-case; preguntar si la ambigüedad afecta scope/behavior/acceptance criteria
- Required set = closure transitiva de los `requires` de `openspec status --json`, no solo `applyRequires`; `status` es solo existencia de archivos
- Por artifact: `openspec instructions <id>` → aplicar `context`/`rules` como constraints, NUNCA copiarlos al archivo de salida
- Re-leer dependencies desde disco antes de escribir cada artifact
- Nunca crear artifacts `skipped` (skip_specs); artefactos condicionales solo si `instruction` lo marca
- Verificar existencia de cada archivo tras escribir; change homónimo existente → preguntar continuar o crear nuevo
- Cerrar con `openspec status` y apuntar a `/opsx-apply`

### openspec-apply-change
- Anunciar change seleccionado; si es ambiguo `openspec list --json` y preguntar
- Arrancar con `openspec status --change --json` y luego `openspec instructions apply --change --json`
- Leer TODOS los `contextFiles` del output antes de codear; nunca asumir nombres de archivo
- `state: "blocked"` → parar; crear/reparar primero el artifact faltante (siguiente `ready` vía instructions)
- Marcar task `- [x]` SOLO cuando esté totalmente implementado; actualizar el checkbox inmediatamente
- Pausar ante ambigüedad, errores o issues de diseño — no adivinar; surfear scope agregado en vez de silenciar/reducir/deferir comportamiento especificado
- Cambios mínimos y scoped a la task actual
- `context` = input requerido, `operationGuidance` = consejo; nunca prueba de completitud; reportar conflictos sin copiarlos a archivos
- `all_done` → sugerir `/opsx-archive`
- Nunca crear la raíz de openspec como side effect (aplica project check)

### openspec-archive-change
- Anunciar selección; ambigua → `openspec list --json` y preguntar (solo changes activos)
- Pre-chequeos: `openspec status --json` (artifacts done/skipped) y `openspec list --json` (tasks) — incompletos ⇒ warn + confirmar, no bloquear
- Nunca inferir completitud de tasks desde artifacts ni desde la existencia de tasks.md; solo cuentan checkboxes `x`/`X`
- `artifactPaths.specs.existingOutputPaths` es la ÚNICA fuente de delta specs
- Si hay delta specs: correr assessment → sync INLINE con openspec-sync-specs y VERIFICAR main specs ANTES de mover changeRoot; nunca archivar con un sync en vuelo
- Capability sync-blocked (MODIFIED/RENAMED sin main spec) → ofrecer solo "archive without syncing" o "cancel"
- Nombre destino `YYYY-MM-DD-<change-name>` salvo ya prefijado con fecha; nunca apilar dos fechas; fallar si el destino existe
- Mover changeRoot con `mv` (`.openspec.yaml` viaja con el directorio)
- Mostrar resumen final con warnings y si los specs fueron sincronizados

### openspec-explore
- Es una postura, no un workflow: sin pasos fijos ni outputs obligatorios; curioso, visual (ASCII diagrams), adaptativo, paciente, anclado al codebase
- NUNCA implementar: sin ediciones de código ni de schemas/templates/config.yaml; si piden construir, hacer handoff a `/opsx-propose`
- Lecturas y comandos read-only sin confirmación; antes de la PRIMERA acción write-capable nombrar archivos/artifacts + cambios, preguntar sí/no directo y esperar confirmación en un mensaje separado
- Respuestas a preguntas de diseño NUNCA son consentimiento para escribir; la confirmación cubre solo el scope descrito
- Capturar la exploración como change a pedido explícito del usuario = esa confirmación; scaffold solo con `openspec new change` — nunca crear directorios de change a mano
- Preguntas de descubrimiento: una enfocada a la vez, resolver primero decisiones bloqueantes, recomendaciones fundamentadas con tradeoffs, nunca inventar intención
- Trackear decisiones en la conversación, no en archivos; silencio no es aceptación
- Aplica project check (nunca crear raíz openspec como side effect; flag store sticky)

### openspec-sync-specs
- Merge dirigido por el agente: leer delta + main specs y editar main specs directamente — nunca copiar un delta completo tal cual
- Fuente de deltas: solo `artifactPaths.specs.existingOutputPaths`; nunca inferir de otros artifacts; respetar subsets provistos
- Main specs bajo `planningHome.root` store-aware `/openspec/specs/` — sin paths hardcodeados del repo
- Preservar todo el contenido del main spec no mencionado en el delta; quitar headers de operación delta; mantener la estructura Main Spec Format
- Aplicar ADDED/MODIFIED/REMOVED/RENAMED exactamente como el delta; preservar los demás scenarios de requirements MODIFIED
- Idempotente: correr dos veces ⇒ mismo resultado
- Fetch `openspec instructions specs` una vez antes de escribir; parar si falla o JSON inválido; `rules` solo construyen el contenido escrito, nunca se copian al output
- Preguntar ante dudas; mostrar los cambios a medida que se hacen

### openspec-update-change
- Revisa artifacts existentes solamente — NUNCA crea faltantes, NUNCA edita código
- Selección: inferir → auto-seleccionar si hay uno solo → si no `openspec list --json` y preguntar (top 3-4 recientes, marcar Recommended); anunciar "Using change: <name>"
- Paths desde `artifactPaths.<id>.existingOutputPaths` — nunca escribir al glob `resolvedOutputPath`; usar ids/paths del CLI, nunca nombres hardcodeados
- Redactar ediciones en la conversación primero; reconciliar TODOS los artifacts en ambas direcciones antes de escribir
- Cada escritura requiere confirmación explícita del usuario, un artifact a la vez; revisiones rechazadas no se escriben
- Rewrites sustanciales: fetch `openspec instructions <id>` primero (template/rules como constraints, no contenido)
- No avanzar la frontier: artifacts `ready`/`blocked` sin archivos → apuntar a instructions; `skipped` intocables
- Si cambia la *intención* del change en vez de refinarla → recomendar un change nuevo distinto
- Apuntar al próximo paso (/opsx-apply o /opsx-archive) como guidance únicamente — nunca actuarlo

### active-orchestrator
- Orquestador delgado: detectar entrypoint, poseer `.active-orchestrator-state.json` (`version`, `step`, `owner`), correr `openspec init`, despachar fases — NUNCA reimplementar la lógica de una fase
- Nunca preguntar contenido estratégico (system_type, scale, stack, checklist de 11 puntos) — eso es de kb-creator / discovery-research
- Nunca escribir knowledge-base/, CHANGES.md, discovery.md, AGENTS.md/CLAUDE.md — son outputs de sub-skills
- Orden de despacho: discovery-research → kb-creator → roadmap-generator → find-skill → skill-registry → agent-instruction
- Checkpoint en cada frontera de fase — nunca fases encadenadas sin el "Continuar" explícito del usuario
- STOP tras cada AskUserQuestion; reanudar por defecto si el estado existe con `step != "done"`
- Nunca instalar autonomamente: find-skill recomienda → el usuario elige → recién ahí instalar
- Verificar presencia de la sub-skill antes de despachar; si falta → ofrecer instalación → degradar si rechaza
- Conceder a cada sub-skill solo los campos de estado que posee; cada una escribe su propia sección
- Las preguntas de routing (¿corro Discovery?) sí; las de contenido, no

### agents-md-generator
- Pre-chequeos: `knowledge-base/` + `02_descripcion_general.md` deben existir → si no, frenar y decir "corré kb-creator"; sin CHANGES.md → generar sin sección Roadmap y avisar
- Output: `AGENTS.md` Y `CLAUDE.md` en la raíz con contenido idéntico (copia, no symlink); nunca dentro de `.claude/` ni `openspec/`
- Leer: KB 02 (tabla de stack), KB README, CHANGES.md (resumen), `.atl/skill-registry.md` como fuente de verdad de skills (NO re-escanear), KB 10 (preguntas abiertas), `~/.claude/CLAUDE.md` global para no repetir reglas universales
- Reglas duras = única parte interactiva: stack-aware (derivar del stack real, nunca hardcodear lenguaje), confirmadas con el usuario, formato "NUNCA X → hacer Y"
- Regla presente en el global → referenciar, no duplicar; regla universal ausente del global → incluirla en el proyecto
- Mapear skills a roles de agente (tabla skill→rol); nunca inventar skills que no estén en el registry
- DRY: nunca copiar compact rules al AGENTS.md — solo el mapa skill→rol + una línea de referencia a `.atl/skill-registry.md`
- Validar con `diff AGENTS.md CLAUDE.md` tras generar
- No usar cuando: falta la KB, el usuario quiere editar UNA regla, o se busca automatización del harness (eso es hooks en settings.json)

### discovery-research
- Corre ANTES de kb-creator; su output (`discovery/discovery.md` + `state.discovery`) es insumo de kb-creator, no reemplazo
- Fase 1: una sola pregunta por fuentes/URLs; si hay URLs invocar web-scraper una por URL y luego `scripts/collect_sources.py`; si no hay, seguir con Q&A — nunca bloquear
- Fase 2: checklist de 11 puntos vía `references/checklist.md`, 3-5 preguntas por ronda, opciones a/b/c + "por qué importa"; no re-preguntar lo que el scraping ya respondió
- Riesgos y preguntas abiertas = supuestos sin probar (lógica de assumption-mapping)
- Fase 3 (gate): resumen de los 11 puntos → confirmación explícita del usuario ANTES de escribir cualquier archivo
- Fase 4: escribir `discovery/discovery.md` en prosa según `assets/example-discovery.md`; actualizar SOLO la sección `discovery` del state file según `references/state-contract.md`
- Nunca escribir archivos ni tocar estado sin el gate confirmado
- Si falta web-scraper → seguir con Q&A pura y avisar al usuario

### find-skills
- Orden de búsqueda: leaderboard de skills.sh primero → `npx skills find [query] [--owner <owner>]` si no lo cubre
- Verificar antes de recomendar: instalaciones ≥1K preferido (cuidado <100), fuentes oficiales (vercel-labs, anthropics, microsoft), ≥100 stars del repo
- Presentar: nombre, qué hace, count de instalaciones, comando de instalación, link de skills.sh
- Instalar con `npx skills add <owner/repo@skill> -g -y` (-g global, -y sin prompts)
- Keywords específicas; probar sinónimos (deploy → deployment / ci-cd)
- Nunca recomendar solo en base a resultados de búsqueda
- Si no hay resultados: decirlo, ofrecer hacer la tarea directamente, sugerir `npx skills init`

### kb-creator
- Auto-detección de modo: `docs/` con fuentes → Mode A silencioso (fire-and-forget, sin preguntas); si no → Mode B interactivo (3-5 preguntas estratégicas, iterar archivo por archivo)
- Output: exactamente 10 archivos canónicos `01_…` a `10_…` + README.md en `knowledge-base/` en la RAÍZ — nunca mezclar con `docs/`
- Extras opcionales solo con prefijo `1X_`/`2X_` kebab-case; nunca reemplazan a los 10 canónicos
- Mode A: dudas van a `10_preguntas_abiertas.md` — nunca inventar valores; cerrar con tabla resumen (archivo → líneas → temas)
- Mode B: marcar supuestos `**Suposición:**`; esperar respuestas antes de generar; no re-preguntar campos de discovery ya presentes en el estado
- State hook (solo si `.active-orchestrator-state.json` existe): escribir SOLO `state.kb`; `source` = "ingest" (Mode A) o "interactive" (Mode B); nunca tocar step/owner/roadmap/skills/agents
- No usar si los 10 canónicos ya existen (sugerir edición puntual) o si se pide un solo documento
- Templates: `assets/canonical-templates.md`, `assets/strategic-questions.md`, `assets/state-contract.md`

### roadmap-generator
- Pre-chequeos: `knowledge-base/` con los 10 canónicos Y `openspec/` en raíz → si falta alguno, NO generar nada y reportar cuál
- Output: un solo `CHANGES.md` en la RAÍZ del proyecto (nunca dentro de `openspec/`); secciones de primer nivel son contrato — no agregar ni quitar
- Leer siempre: 04_modelo_de_datos, 06_funcionalidades, 07_flujos_principales, 08_arquitectura_propuesta; opcionalmente 03/05/10
- Modo orquestado: usar `state.kb.files` como lista autoritativa de archivos; `state.kb.discovery` es solo hint (los archivos son la fuente de verdad); fallback a disco
- Incluir: árbol de dependencias, gates de paralelismo, camino crítico, plan multi-agente, por change: scope + nivel de governance + dependencias + punteros "Leer antes" a la KB
- Fire-and-forget — sin preguntas al usuario
- State hook: escribir solo `state.roadmap` según `assets/state-contract.md`
- Si el usuario quiere editar UN change de un CHANGES.md ya completo → sugerir edición puntual, no regenerar

### skill-creator
- Flujo: capturar intent → interview → draft del SKILL.md → test prompts → evals cualitativas + cuantitativas → rewrite → expandir set de tests
- Extraer primero de la conversación (herramientas, pasos, correcciones) antes de preguntar al usuario
- Sugerir test cases para skills con outputs verificables objetivamente; las subjetivas suelen no necesitarlos — decide el usuario
- El `description` del frontmatter gobierna el trigger: cerrar con un "Use when…" claro; optimizarlo con el script de description optimizer
- Usar los subagents provistos (analyzer, grader, comparator); schemas en `references/schemas.md` (evals, grading, metrics, benchmark)
- Benchmark con análisis de varianza; hay modo blind comparison para A/B
- Adaptar el nivel de comunicación a la familiaridad del usuario con el jargon (explicar JSON/assertion salvo señales claras)
- Flexible: si el usuario dice "solo hazlo a ojo", saltear el loop de evals

### web-scraper
- Esquema de salida fijo: 8 campos, siempre, en el mismo orden — `(no publicado)` cuando falta; NUNCA inventar datos
- Un WebFetch por URL con prompt que pida explícitamente los 8 campos (ver `references/output-schema.md`)
- Si sale vacío/shell de SPA/403/paywall/CAPTCHA → registrar la limitación en el campo, sin reintentos de evasión, seguir con la siguiente URL
- Escribir `discovery/sources/<slug>.md` (slug vía `scripts/slugify.py`) — corridas repetidas pisan el mismo archivo
- Varias URLs: procesar una por una y reportar resueltas/fallidas al final; no abortar el lote
- Skill de solo lectura — sin gate de aprobación; no escribir fuera de discovery/sources
- Sin crawling ni scraping masivo — solo páginas provistas explícitamente (limitación v1; Playwright = extensión futura)
- Validar el esquema http(s); agregarlo si falta

## Project Conventions

| File | Path | Notes |
|------|------|-------|
| — | — | Ningún archivo de convenciones existe todavía (AGENTS.md, CLAUDE.md, .cursorrules, GEMINI.md, copilot-instructions.md: no encontrados). La fase `agent-instruction` (agents-md-generator) está pendiente — volver a escanear tras correrla. |

Read the convention files listed above for project-specific patterns and rules. All referenced paths have been extracted — no need to read index files to discover more.
