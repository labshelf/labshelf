/**
 * Flat block groups of an HTML deck: blocks that share a data-group value move and select together; no wrapper element and no nesting.
 */
import { attributeRemoval, blockTagAttributes, type DeckSplice } from "./deckCells.js";
import type { DeckBlock, DeckModel } from "./deckParse.js";

const GROUP_ID = /^[a-z][a-z0-9-]{0,39}$/;

const allBlocks = (model: DeckModel): DeckBlock[] => model.slides.flatMap((slide) => slide.blocks);

/** The blocks carrying data-group="<group>", in document order. */
export function deckGroupMembers(model: DeckModel, group: string): DeckBlock[] {
  return allBlocks(model).filter((block) => block.group === group);
}

/** Sets data-group on each listed block (replacing an old value, else after data-block); an error message when the blocks or the id cannot form a group. */
export function groupSplices(html: string, model: DeckModel, ids: readonly string[], group: string): DeckSplice[] | string {
  if (!Array.isArray(ids)) return "The blocks to group must be a list of block ids.";
  const unique = [...new Set(ids)];
  if (unique.length < 2) return "A group needs at least two blocks.";
  if (typeof group !== "string" || !GROUP_ID.test(group)) return `The group id "${String(group)}" is not valid; use a lowercase letter followed by up to 39 lowercase letters, digits or hyphens.`;
  const blocks = allBlocks(model);
  if (blocks.some((block) => block.id === group)) return `The group id "${group}" is already a block id.`;
  const members: DeckBlock[] = [];
  for (const id of unique) {
    const block = blocks.find((candidate) => candidate.id === id);
    if (!block) return `No block has the id "${String(id)}".`;
    members.push(block);
  }
  if (members.some((block) => block.slide !== members[0]!.slide)) return "The blocks of a group must be on the same slide.";
  return members.map((block) => {
    const attributes = blockTagAttributes(html, block);
    const old = attributes.find((attribute) => attribute.name === "data-group");
    if (old?.valueRange) return { ...old.valueRange, text: group };
    if (old) return { ...old.range, text: `data-group="${group}"` };
    const anchor = attributes.find((attribute) => attribute.name === "data-block")!;
    return { from: anchor.range.to, to: anchor.range.to, text: ` data-group="${group}"` };
  });
}

/** Removes data-group from every block of the group; an error message when no block carries it. */
export function ungroupSplices(html: string, model: DeckModel, group: string): DeckSplice[] | string {
  const members = deckGroupMembers(model, group);
  if (members.length === 0) return `No block is in the group "${String(group)}".`;
  return members.map((block) => attributeRemoval(html, blockTagAttributes(html, block).find((attribute) => attribute.name === "data-group")!));
}
