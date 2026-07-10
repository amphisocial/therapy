#!/usr/bin/env python3
from pathlib import Path
from datetime import datetime
import re
import shutil

ROOT = Path.cwd()
STAMP = datetime.now().strftime('%Y%m%d-%H%M%S')
PACKAGE_ROOT = Path(__file__).resolve().parents[1]


def backup(path: Path):
    if path.exists():
        b = path.with_name(path.name + f'.backup.aba-skill-{STAMP}')
        b.write_text(path.read_text())
        print(f'Backed up {path} -> {b}')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new.strip() in text:
        print(f'Skipping {label}; already applied.')
        return text
    if old not in text:
        raise SystemExit(f'Could not find marker/block for {label}.')
    return text.replace(old, new, 1)


def copy_skill_file():
    src = PACKAGE_ROOT / 'config' / 'aba-bcba-agent.skill.md'
    dest_dir = ROOT / 'config'
    dest_dir.mkdir(exist_ok=True)
    dest = dest_dir / 'aba-bcba-agent.skill.md'
    if dest.exists():
        backup(dest)
    shutil.copyfile(src, dest)
    print(f'Copied configurable ABA skill file -> {dest}')


copy_skill_file()

# -----------------------------------------------------------------------------
# server.js: add configurable ABA skill loader and use it in Workbench prompt
# -----------------------------------------------------------------------------
server = ROOT / 'server.js'
backup(server)
s = server.read_text()

# Support absolute or relative ABA_AGENT_SKILL_PATH.
s = s.replace('import { dirname, join } from "node:path";', 'import { dirname, join, isAbsolute } from "node:path";')

# Add env var near ALLOW_PHI_TO_LLM.
old_env = 'const ALLOW_PHI_TO_LLM = String(process.env.ALLOW_PHI_TO_LLM || "false").toLowerCase() === "true";'
new_env = old_env + '\nconst ABA_AGENT_SKILL_PATH = process.env.ABA_AGENT_SKILL_PATH || "config/aba-bcba-agent.skill.md";'
s = replace_once(s, old_env, new_env, 'ABA_AGENT_SKILL_PATH env var')

loader = r'''
const DEFAULT_ABA_AGENT_SKILL = `# ABA-Skilled BCBA Agent Skill

You are the ABA-Skilled BCBA Agent inside TherapyAgent.

You support ABA-informed documentation review, plan-preparation support, behavior pattern review, report drafting, and transparent risk-signal interpretation.

You do not diagnose, prescribe treatment, determine medical necessity, make final clinical decisions, claim guaranteed prediction, or replace clinician judgment.

Use only the provided TherapyAgent context and user question. Flag uncertainty and missing data. Do not fabricate patient history or citations. Treat analytics as risk signals unless the organization has validated a predictive model.

Required answer structure: concise summary; evidence-linked observations; ABA-informed considerations; suggested BCBA review actions; data gaps; predictive/risk-signal considerations; clinician-review disclaimer.

End with: This is clinical decision-support only and requires BCBA review.`;

function resolveAppPath(configuredPath = "") {
  return isAbsolute(configuredPath) ? configuredPath : join(__dirname, configuredPath);
}

function getAbaAgentSkill() {
  const configuredPath = ABA_AGENT_SKILL_PATH || "config/aba-bcba-agent.skill.md";
  try {
    const text = readFileSync(resolveAppPath(configuredPath), "utf8");
    return { text, path: configuredPath, source: "file" };
  } catch (e) {
    console.warn(`[aba-agent-skill] Could not read ${configuredPath}; using built-in fallback: ${e.message}`);
    return { text: DEFAULT_ABA_AGENT_SKILL, path: configuredPath, source: "built_in_fallback" };
  }
}

function loadAbaAgentSkill() {
  return getAbaAgentSkill().text;
}

'''
# Insert before buildAbaWorkbenchPrompt if not already present.
if 'function getAbaAgentSkill()' not in s:
    marker = 'function buildAbaWorkbenchPrompt(ctx, question, mode) {'
    if marker not in s:
        raise SystemExit('Could not find buildAbaWorkbenchPrompt marker. Apply the Analytics + AI Workbench update first.')
    s = s.replace(marker, loader + marker, 1)
else:
    print('Skipping skill loader; already applied.')

# Replace buildAbaWorkbenchPrompt body with configurable version.
pattern = re.compile(r'function buildAbaWorkbenchPrompt\(ctx, question, mode\) \{.*?\n\}\n\napp\.get\("/api/ai/workbench/bootstrap"', re.S)
new_build = r'''function buildAbaWorkbenchPrompt(ctx, question, mode) {
  const skill = loadAbaAgentSkill();
  const contextJson = JSON.stringify(ctx, null, 2).slice(0, 22000);
  return `${skill}

## TherapyAgent Runtime Instructions

Current workbench mode: ${mode || "general"}
Current user question: ${question}

Use only the TherapyAgent context JSON below and the user's question. If the context is insufficient, state the gap instead of guessing.

TherapyAgent context JSON:
${contextJson}

Respond using the required answer structure from the skill file. Include evidence references to TherapyAgent record types such as session logs, behavior events, incidents, therapy plans, and AI reports when applicable.`;
}

app.get("/api/ai/workbench/bootstrap"'''
if 'const skill = loadAbaAgentSkill();' not in s:
    s2, count = pattern.subn(new_build, s, count=1)
    if count != 1:
        raise SystemExit('Could not replace buildAbaWorkbenchPrompt function. Check server.js around AI Workbench routes.')
    s = s2
else:
    print('Skipping buildAbaWorkbenchPrompt replacement; already applied.')

# Expose skill status in AI Workbench bootstrap.
old_bootstrap = 'res.json({ patients, history });'
new_bootstrap = 'res.json({ patients, history, agent_skill: { path: getAbaAgentSkill().path, source: getAbaAgentSkill().source } });'
s = replace_once(s, old_bootstrap, new_bootstrap, 'AI Workbench bootstrap skill metadata')

server.write_text(s)

# -----------------------------------------------------------------------------
# public/workspace.html: add visible skill status line in AI Workbench
# -----------------------------------------------------------------------------
workspace = ROOT / 'public' / 'workspace.html'
backup(workspace)
s = workspace.read_text()
old_card = '''        <section class="ai-knowledge-card">
          <h3>ABA Knowledge Base</h3>
          <p>Future enhancement: upload organization-approved ABA resources, clinical templates, public-domain guidance, and licensed materials. TherapyAgent will not preload copyrighted ABA books unless your organization has rights to use them.</p>
        </section>'''
new_card = '''        <section class="ai-knowledge-card">
          <h3>ABA Knowledge Base</h3>
          <p id="aiWorkbenchSkillStatus" class="muted">Agent skill: loading...</p>
          <p>Future enhancement: upload organization-approved ABA resources, clinical templates, public-domain guidance, and licensed materials. TherapyAgent will not preload copyrighted ABA books unless your organization has rights to use them.</p>
        </section>'''
if 'id="aiWorkbenchSkillStatus"' not in s:
    s = replace_once(s, old_card, new_card, 'AI Workbench skill status UI')
else:
    print('Skipping workspace skill status; already applied.')
workspace.write_text(s)

# -----------------------------------------------------------------------------
# public/app.js: render skill status returned by bootstrap
# -----------------------------------------------------------------------------
appjs = ROOT / 'public' / 'app.js'
backup(appjs)
s = appjs.read_text()
old_render = '''  const hist = $("#aiWorkbenchHistory");
  if (hist) {'''
new_render = '''  const skillEl = $("#aiWorkbenchSkillStatus");
  if (skillEl) {
    const skill = out.agent_skill || {};
    const source = skill.source === "file" ? "file loaded" : "built-in fallback";
    skillEl.textContent = `Agent skill: ${skill.path || "config/aba-bcba-agent.skill.md"} (${source})`;
  }
  const hist = $("#aiWorkbenchHistory");
  if (hist) {'''
if 'Agent skill: ${skill.path' not in s:
    s = replace_once(s, old_render, new_render, 'app.js skill status render')
else:
    print('Skipping app.js skill status render; already applied.')
appjs.write_text(s)

# -----------------------------------------------------------------------------
# README / release notes
# -----------------------------------------------------------------------------
readme = ROOT / 'README.md'
if readme.exists():
    backup(readme)
    r = readme.read_text()
    note = '''

## Configurable ABA-Skilled BCBA Agent Skill

TherapyAgent AI Workbench can load its BCBA-agent instructions from a configurable Markdown skill file.

Default path:

```bash
ABA_AGENT_SKILL_PATH=config/aba-bcba-agent.skill.md
```

The default skill file is stored at `config/aba-bcba-agent.skill.md` and can be edited without changing `server.js`.

When `ALLOW_PHI_TO_LLM=false`, TherapyAgent uses local no-PHI analysis. When `ALLOW_PHI_TO_LLM=true`, the configured skill file is included in the LLM prompt along with the permitted TherapyAgent context.
'''
    if 'Configurable ABA-Skilled BCBA Agent Skill' not in r:
        readme.write_text(r.rstrip() + note + '\n')

Path('RELEASE_NOTES.txt').write_text('''TherapyAgent Configurable ABA Skill Update

- Adds config/aba-bcba-agent.skill.md.
- Adds ABA_AGENT_SKILL_PATH .env support.
- AI Workbench LLM prompt now reads agent instructions from the skill file.
- AI Workbench bootstrap reports whether the skill file was loaded or built-in fallback was used.
- Keeps local no-PHI mode intact when ALLOW_PHI_TO_LLM=false.
''')

print('\nConfigurable ABA skill update applied.')
print('Next: node --check server.js && node --check public/app.js && pm2 restart therapyagent --update-env')
