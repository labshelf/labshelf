// Starts monaco-vscode-api's workbench in a container, with the services the editor page needs, over one workspace folder.
import { initialize } from "@codingame/monaco-vscode-api";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import getConfigurationOverride from "@codingame/monaco-vscode-configuration-service-override";
import getDialogsOverride from "@codingame/monaco-vscode-dialogs-service-override";
import getExplorerOverride from "@codingame/monaco-vscode-explorer-service-override";
import getExtensionsOverride from "@codingame/monaco-vscode-extensions-service-override";
import getFilesOverride from "@codingame/monaco-vscode-files-service-override";
import getKeybindingsOverride from "@codingame/monaco-vscode-keybindings-service-override";
import getLanguagesOverride from "@codingame/monaco-vscode-languages-service-override";
import getLogOverride from "@codingame/monaco-vscode-log-service-override";
import getMarkersOverride from "@codingame/monaco-vscode-markers-service-override";
import getModelOverride from "@codingame/monaco-vscode-model-service-override";
import getStorageOverride from "@codingame/monaco-vscode-storage-service-override";
import getTextmateOverride from "@codingame/monaco-vscode-textmate-service-override";
import getThemeOverride from "@codingame/monaco-vscode-theme-service-override";
import "@codingame/monaco-vscode-latex-default-extension";
import "@codingame/monaco-vscode-theme-defaults-default-extension";
import getWorkbenchOverride from "@codingame/monaco-vscode-workbench-service-override";
import { TRIMMED_LAYOUT } from "./trimmedLayout";
import { installWebviewHost } from "./webviewHost";
import { installWorkerEnvironment } from "./workerEnvironment";

export interface WorkbenchOptions {
  folder: URI;
}

export async function bootWorkbench(container: HTMLElement, { folder }: WorkbenchOptions): Promise<void> {
  installWorkerEnvironment();
  installWebviewHost();
  await initialize({
    ...getLogOverride(), ...getFilesOverride(), ...getStorageOverride(), ...getConfigurationOverride(), ...getKeybindingsOverride(),
    ...getModelOverride(), ...getLanguagesOverride(), ...getTextmateOverride(), ...getThemeOverride(), ...getMarkersOverride(),
    ...getExtensionsOverride({ enableWorkerExtensionHost: true }), ...getWorkbenchOverride(), ...getExplorerOverride(), ...getDialogsOverride(),
  }, container, {
    configurationDefaults: TRIMMED_LAYOUT,
    productConfiguration: { nameShort: "LabShelf", nameLong: "LabShelf" },
    workspaceProvider: { trusted: true, workspace: { folderUri: folder }, open: async () => false },
  });
}
