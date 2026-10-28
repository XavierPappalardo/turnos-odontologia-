import json

path = r'C:\Users\T\OneDrive\Desktop\turnos-odontologia-\.atl\skill-registry.md'
with open(path, encoding='utf-8') as f:
    content = f.read()

old = '| "openspec update change" / "opsx update" — revisar los artifacts de planificación de un change (nunca edita código) | openspec-update-change | .agents/openspec-update-change/SKILL.md |\n| /active-orchestrator:init, :kb, :rules, :discovery, :openspec, :devops, :find-skill — arrancar un proyecto nuevo con el flujo de fundación SDD/OpenSpec | active-orchestrator | .agents/active-orchestrator/SKILL.md |'

new = '| "openspec update change" / "opsx update" — revisar los artifacts de planificación de un change (nunca edita código) | openspec-update-change | .agents/openspec-update-change/SKILL.md |\n| /active-orchestrator:init, :kb, :rules, :discovery, :openspec, :devops, :find-skill — arrancar un proyecto nuevo con el flujo de fundación SDD/OpenSpec | active-orchestrator | .agents/active-orchestrator/SKILL.md |\n| Preparar/implementar C-02 core-models, crear entidades/migraciones para Turno/Profesional/SillonBox/Paciente/Prestacion/Bloqueo/ObraSocialPlan/Pago siguiendo convenciones (BaseRepository/UnitOfWork, AuditMixin, solapamientos) | core-models-scaffolder | .agents/core-models-scaffolder/SKILL.md |'

if 'core-models-scaffolder' not in content:
    content = content.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('updated')
else:
    print('exists')
