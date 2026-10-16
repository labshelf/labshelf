// Approximates the VS Code light and dark theme variables a webview receives, for headless screenshots.
const common = `--vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --vscode-font-size: 13px; --vscode-editor-font-family: Menlo, Monaco, monospace;`;
export const light = `:root{${common}
--vscode-foreground:#3b3b3b;--vscode-descriptionForeground:#717171;--vscode-editor-background:#ffffff;--vscode-sideBar-background:#f8f8f8;--vscode-sideBar-border:#e5e5e5;
--vscode-sideBarSectionHeader-background:#f8f8f8;--vscode-sideBarSectionHeader-border:#e5e5e5;--vscode-sideBarSectionHeader-foreground:#3b3b3b;
--vscode-panel-border:#e5e5e5;--vscode-widget-border:#e5e5e5;--vscode-widget-shadow:rgba(0,0,0,.16);--vscode-focusBorder:#005fb8;
--vscode-list-hoverBackground:#f2f2f2;--vscode-list-activeSelectionBackground:#e8e8e8;--vscode-list-activeSelectionForeground:#000;--vscode-list-inactiveSelectionBackground:#e4e6f1;--vscode-list-focusOutline:#005fb8;--vscode-list-dropBackground:#d6ebff;
--vscode-input-background:#fff;--vscode-input-foreground:#3b3b3b;--vscode-input-border:#cecece;--vscode-input-placeholderForeground:#767676;
--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;--vscode-button-hoverBackground:#0258a8;--vscode-button-secondaryBackground:#e5e5e5;--vscode-button-secondaryForeground:#3b3b3b;--vscode-button-secondaryHoverBackground:#cccccc;
--vscode-badge-background:#cccccc;--vscode-badge-foreground:#3b3b3b;--vscode-textLink-foreground:#005fb8;--vscode-textCodeBlock-background:#f2f2f2;
--vscode-toolbar-hoverBackground:rgba(184,184,184,.31);--vscode-toolbar-activeBackground:rgba(166,166,166,.31);
--vscode-menu-background:#fff;--vscode-menu-foreground:#3b3b3b;--vscode-menu-border:#cecece;--vscode-menu-selectionBackground:#005fb8;--vscode-menu-selectionForeground:#fff;--vscode-menu-separatorBackground:#d4d4d4;
--vscode-editorWidget-background:#f8f8f8;--vscode-errorForeground:#f85149;--vscode-editorWarning-foreground:#bf8803;--vscode-charts-blue:#1a85ff;--vscode-charts-green:#388a34;--vscode-charts-yellow:#bf8803;
--vscode-scrollbarSlider-background:rgba(100,100,100,.4);--vscode-scrollbarSlider-hoverBackground:rgba(100,100,100,.7);--vscode-scrollbarSlider-activeBackground:rgba(0,0,0,.6);
--vscode-statusBar-background:#f8f8f8;--vscode-statusBar-foreground:#3b3b3b;--vscode-statusBarItem-hoverBackground:rgba(0,0,0,.12);--vscode-tree-indentGuidesStroke:#a9a9a9;
--vscode-progressBar-background:#0078d4;--vscode-panelTitle-activeBorder:#005fb8;--vscode-sash-hoverBorder:#005fb8;--vscode-editor-findMatchHighlightBackground:rgba(234,92,0,.33);
--vscode-keybindingLabel-background:rgba(221,221,221,.4);--vscode-keybindingLabel-border:rgba(204,204,204,.4);--vscode-keybindingLabel-bottomBorder:rgba(187,187,187,.4);--vscode-keybindingLabel-foreground:#3b3b3b;
--vscode-inputValidation-warningBackground:#f6f5d2;--vscode-inputValidation-warningBorder:#bf8803}
html,body{height:100%}body{background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:13px;margin:0}`;
export const dark = `:root{${common}
--vscode-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-editor-background:#1f1f1f;--vscode-sideBar-background:#181818;--vscode-sideBar-border:#2b2b2b;
--vscode-sideBarSectionHeader-background:#181818;--vscode-sideBarSectionHeader-border:#2b2b2b;--vscode-sideBarSectionHeader-foreground:#cccccc;
--vscode-panel-border:#2b2b2b;--vscode-widget-border:#313131;--vscode-widget-shadow:rgba(0,0,0,.36);--vscode-focusBorder:#0078d4;
--vscode-list-hoverBackground:#2a2d2e;--vscode-list-activeSelectionBackground:#04395e;--vscode-list-activeSelectionForeground:#fff;--vscode-list-inactiveSelectionBackground:#37373d;--vscode-list-focusOutline:#0078d4;--vscode-list-dropBackground:#383b3d;
--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-input-border:#3c3c3c;--vscode-input-placeholderForeground:#989898;
--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;--vscode-button-hoverBackground:#026ec1;--vscode-button-secondaryBackground:#313131;--vscode-button-secondaryForeground:#cccccc;--vscode-button-secondaryHoverBackground:#3c3c3c;
--vscode-badge-background:#616161;--vscode-badge-foreground:#f8f8f8;--vscode-textLink-foreground:#4daafc;--vscode-textCodeBlock-background:#2b2b2b;
--vscode-toolbar-hoverBackground:rgba(90,93,94,.31);--vscode-toolbar-activeBackground:rgba(99,102,103,.31);
--vscode-menu-background:#1f1f1f;--vscode-menu-foreground:#cccccc;--vscode-menu-border:#454545;--vscode-menu-selectionBackground:#0078d4;--vscode-menu-selectionForeground:#fff;--vscode-menu-separatorBackground:#454545;
--vscode-editorWidget-background:#202020;--vscode-errorForeground:#f85149;--vscode-editorWarning-foreground:#cca700;--vscode-charts-blue:#3794ff;--vscode-charts-green:#89d185;--vscode-charts-yellow:#cca700;
--vscode-scrollbarSlider-background:rgba(121,121,121,.4);--vscode-scrollbarSlider-hoverBackground:rgba(100,100,100,.7);--vscode-scrollbarSlider-activeBackground:rgba(191,191,191,.4);
--vscode-statusBar-background:#181818;--vscode-statusBar-foreground:#cccccc;--vscode-statusBarItem-hoverBackground:rgba(255,255,255,.12);--vscode-tree-indentGuidesStroke:#585858;
--vscode-progressBar-background:#0078d4;--vscode-panelTitle-activeBorder:#0078d4;--vscode-sash-hoverBorder:#0078d4;--vscode-editor-findMatchHighlightBackground:rgba(234,92,0,.33);
--vscode-keybindingLabel-background:rgba(128,128,128,.17);--vscode-keybindingLabel-border:rgba(51,51,51,.6);--vscode-keybindingLabel-bottomBorder:rgba(68,68,68,.6);--vscode-keybindingLabel-foreground:#cccccc;
--vscode-inputValidation-warningBackground:#352a05;--vscode-inputValidation-warningBorder:#9d8a00}
html,body{height:100%}body{background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:13px;margin:0}`;
