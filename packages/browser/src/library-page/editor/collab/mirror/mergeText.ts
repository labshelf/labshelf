// Merges a disk edit and a share edit of one text file line by line, with the browser build of node-diff3.
import { createTextMerge, type MergeText } from "@labshelf/core";
import { diff3Merge } from "node-diff3";

export const browserMergeText: MergeText = createTextMerge(diff3Merge);
