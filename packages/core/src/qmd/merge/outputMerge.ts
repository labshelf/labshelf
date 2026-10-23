// Settles cell results that both sides of a merge hold differently, so a result never gets conflict markers.
// CONTRACT: documents/contracts/qmd-items.md#merge
import { findOutputs, type OutputBlock } from "../outputs/index.js";

/**
 * For each cell with exactly one result on each side and different results, writes the result of the later run into
 * both bodies; a tie keeps the local one.
 */
export function settleOutputs(local: string, other: string): { local: string; other: string } {
  const localBlocks = singleBlocks(local);
  const otherBlocks = singleBlocks(other);
  let settledLocal = local;
  let settledOther = other;
  for (const [cell, localBlock] of localBlocks) {
    const otherBlock = otherBlocks.get(cell);
    if (!otherBlock) { continue; }
    const localText = local.slice(localBlock.start, localBlock.end);
    const otherText = other.slice(otherBlock.start, otherBlock.end);
    if (localText === otherText) { continue; }
    if ((otherBlock.ran ?? "") > (localBlock.ran ?? "")) {
      settledLocal = settledLocal.replace(localText, () => otherText);
    } else {
      settledOther = settledOther.replace(otherText, () => localText);
    }
  }
  return { local: settledLocal, other: settledOther };
}

function singleBlocks(body: string): Map<string, OutputBlock> {
  const blocks = new Map<string, OutputBlock>();
  const repeated = new Set<string>();
  for (const block of findOutputs(body)) {
    if (blocks.has(block.cell)) { repeated.add(block.cell); }
    blocks.set(block.cell, block);
  }
  for (const cell of repeated) { blocks.delete(cell); }
  return blocks;
}
