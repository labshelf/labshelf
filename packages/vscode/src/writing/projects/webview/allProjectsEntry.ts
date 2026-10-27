// Mounts the shared All projects page over the webview messaging API (entry of dist/projects/projects.js); the extension host answers in writing/projects.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/toast.css";
import "@labshelf/core/styles/library-ui.css";
import "@labshelf/core/styles/library-list.css";
import "@labshelf/core/styles/library-detail.css";
import "@labshelf/core/styles/library-tabs.css";
import "@labshelf/core/styles/library-sidebar.css";
import "@labshelf/core/styles/all-projects.css";
import { findElement, mountAllProjects } from "@labshelf/core/dom";
import type { AllProjectsToHost, HostToAllProjects } from "@labshelf/core";
import { createWebviewChannel } from "../../../webview/index.js";

mountAllProjects(findElement("root"), createWebviewChannel<AllProjectsToHost, HostToAllProjects>());
