/**
 * VS Code entry of the settings bundle (dist/settings/settings.js): mounts the core settings page, asks the host for
 * its state and renders every state it sends. The extension host answers in ui/settings.
 */
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/settings.css";
import { $ } from "@labshelf/core/dom";
import { createSettingsChannel, mountSettingsPage } from "./index.js";

const channel = createSettingsChannel();
const page = mountSettingsPage($("root"), (action) => channel.post({ type: "action", action }));
channel.subscribe((message) => page.update(message.state));
channel.post({ type: "ready" });
