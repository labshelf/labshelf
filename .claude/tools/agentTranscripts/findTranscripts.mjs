// Locates a session's main transcript and its subagent transcripts under ~/.claude/projects.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const projectsRoot = () => join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');

// PLATFORM: Claude Code names a project folder after its cwd with every non-alphanumeric character as "-".
const projectDir = (cwd) => join(projectsRoot(), cwd.replace(/[^a-zA-Z0-9]/g, '-'));

function newestSession(dir) {
  const files = readdirSync(dir).filter((name) => name.endsWith('.jsonl')).map((name) => join(dir, name));
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

function resolveMain(arg, cwd) {
  if (arg?.endsWith('.jsonl') && existsSync(arg)) return arg;
  const dirs = [projectDir(cwd), ...readdirSync(projectsRoot()).map((name) => join(projectsRoot(), name))];
  if (!arg) return existsSync(dirs[0]) ? newestSession(dirs[0]) : undefined;
  return dirs.map((dir) => join(dir, `${arg}.jsonl`)).find(existsSync);
}

function readMeta(transcript) {
  try {
    return JSON.parse(readFileSync(transcript.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
  } catch {
    return {};
  }
}

// Returns { main, agents: [{ path, description, type }] } or undefined when no transcript matches.
export function findSessionTranscripts(arg, cwd = process.cwd()) {
  const main = resolveMain(arg, cwd);
  if (!main) return undefined;
  const subagentDir = join(dirname(main), basename(main, '.jsonl'), 'subagents');
  const names = existsSync(subagentDir) ? readdirSync(subagentDir).filter((name) => name.endsWith('.jsonl')) : [];
  const agents = names.map((name) => {
    const path = join(subagentDir, name);
    const meta = readMeta(path);
    return { path, description: meta.description ?? name, type: meta.agentType ?? 'agent' };
  });
  return { main, agents };
}
