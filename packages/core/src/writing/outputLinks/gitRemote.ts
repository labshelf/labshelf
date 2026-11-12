/** A source folder's git remote: read from `.git/config` text, and normalised so the same repository compares equal over HTTPS and SSH. */
// CONTRACT: documents/contracts/library-format.md#linked-outputs

/** The url of remote "origin", else of the first remote, in git config text; undefined when there is none. */
export function parseGitRemote(config: string): string | undefined {
  const remotes: Array<{ name: string; url?: string }> = [];
  let current: { name: string; url?: string } | undefined;
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.replace(/^\s+|\s*(?:[#;].*)?$/g, "");
    const section = /^\[\s*([^\s\]"]+)(?:\s+"([^"]*)")?\s*\]$/.exec(line);
    if (section) {
      current = section[1]!.toLowerCase() === "remote" && section[2] !== undefined ? { name: section[2] } : undefined;
      if (current) { remotes.push(current); }
      continue;
    }
    const entry = /^url\s*=\s*(.*)$/i.exec(line);
    if (current && entry && current.url === undefined) { current.url = entry[1]!.replace(/^"(.*)"$/, "$1"); }
  }
  const withUrl = remotes.filter((remote) => remote.url);
  return (withUrl.find((remote) => remote.name === "origin") ?? withUrl[0])?.url;
}

/** `https://GitHub.com/ana/x.git`, `git@github.com:ana/x` and `ssh://git@github.com/ana/x/` all give `github.com/ana/x`. */
export function normalizeRemote(url: string): string {
  let rest = url.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.*)$/.exec(rest);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(rest)) { rest = `${scp[1]}/${scp[2]}`; }
  rest = rest.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^[^@/]+@/, "");
  const slash = rest.indexOf("/");
  const host = (slash < 0 ? rest : rest.slice(0, slash)).toLowerCase().replace(/:\d+$/, "");
  return `${host}${slash < 0 ? "" : rest.slice(slash)}`.replace(/\/+$/, "");
}
