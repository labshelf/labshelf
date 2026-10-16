/** Opens a writing project's source file at the line that cites a paper, refusing paths outside the project folder. */
import * as vscode from 'vscode';
import { LOG_MODULE, type ListHostContext } from './hostContext.js';

/** @param file "/"-separated path below the project folder; @param line zero-based. */
export async function openProjectSource(ctx: ListHostContext, project: string, file: string, line: number): Promise<void> {
  const folder = ctx.deps.projectBacklinks?.projectFolder(project);
  if (!folder) {
    await ctx.deps.logger.log('WARN', LOG_MODULE, 'List asked for a source of a project that is not here', { project, file });
    ctx.notice('error', `The project "${project}" is not in the Writing view`);
    return;
  }
  const path = ctx.deps.pathOps;
  const target = path.resolve(folder, ...file.split('/'));
  const relative = path.relative(folder, target);
  // The webview is untrusted: a path that leaves the project folder is not opened.
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    await ctx.deps.logger.log('WARN', LOG_MODULE, 'List asked for a source outside its project folder', { project, file });
    return;
  }
  await ctx.deps.logger.log('INFO', LOG_MODULE, 'List opens a project source', { project, file, line });
  const position = new vscode.Position(line, 0);
  await vscode.window.showTextDocument(vscode.Uri.file(target), { selection: new vscode.Range(position, position) });
}
