// Declares the settings that trim the workbench to a writer's layout: editor, explorer, LabShelf views and panels, no IDE chrome.
export const TRIMMED_LAYOUT: Readonly<Record<string, unknown>> = {
  // The few view containers sit as tabs above the side bar instead of a code IDE's activity bar.
  "workbench.activityBar.location": "top",
  "workbench.layoutControl.enabled": false,
  "workbench.startupEditor": "none",
  "workbench.tips.enabled": false,
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "window.commandCenter": false,
  "window.menuBarVisibility": "compact",
  "chat.disableAIFeatures": true,
  "extensions.ignoreRecommendations": true,
};
