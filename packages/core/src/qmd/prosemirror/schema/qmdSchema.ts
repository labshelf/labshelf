// Builds the ProseMirror schema of LabShelf Markdown item bodies.
// CONTRACT: documents/contracts/qmd-items.md#format
import { Schema } from "prosemirror-model";
import { blockNodes } from "./blockNodes.js";
import { inlineNodes } from "./inlineNodes.js";
import { marks } from "./marks.js";

export const qmdSchema = new Schema({ nodes: { ...blockNodes, ...inlineNodes }, marks });
