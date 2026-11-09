// Mounts the shared Account view (entry of dist/account/account.js) over the VS Code messaging transport.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/code-themes.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/settings.css";
import "@labshelf/core/styles/account.css";
import { createAccountClient, type AccountToHost, type HostToAccount } from "@labshelf/core";
import { findElement, mountAccountView } from "@labshelf/core/dom";
import { createWebviewTransport } from "../../webview/index.js";

const end = createWebviewTransport<AccountToHost, HostToAccount>(acquireVsCodeApi());
mountAccountView(findElement("root"), createAccountClient(end));
