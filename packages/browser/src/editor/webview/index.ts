// Names the webview host files the build emits next to the editor page, which replace VS Code's own webview host there.
export const WEBVIEW_HOST_FILES = {
  index: "webview/index.html",
  fake: "webview/fake.html",
} as const;
