// Builds the history target of a project folder on the real disk, with its history kept in another folder.
import { nodeFileReads } from "../../project/node/index.js";
import type { HistoryProject } from "../historyStorage.js";
import { createNodeHistoryStorage } from "./createNodeHistoryStorage.js";

export function createNodeHistoryProject(folder: string, historyDir: string): HistoryProject {
  return { project: nodeFileReads, folder, storage: createNodeHistoryStorage(historyDir) };
}
