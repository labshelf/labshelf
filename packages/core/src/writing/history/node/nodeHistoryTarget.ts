// Builds the history target of a project folder on the real disk, with its history kept in another folder.
import { nodeFileReads } from "../../project/node/index.js";
import type { HistoryTarget } from "../historyStorage.js";
import { nodeHistoryStorage } from "./nodeHistoryStorage.js";

export function nodeHistoryTarget(folder: string, historyDir: string): HistoryTarget {
  return { project: nodeFileReads, folder, storage: nodeHistoryStorage(historyDir) };
}
