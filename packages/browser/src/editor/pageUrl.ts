// Names the editor page's address: the extension path that opens it on a project.
export const PROJECT_PARAM = "project";

export function editorPagePath(projectId: string): string {
  return `editor/index.html?${PROJECT_PARAM}=${encodeURIComponent(projectId)}`;
}
