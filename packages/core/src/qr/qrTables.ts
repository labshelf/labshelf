// QR tables and Reed-Solomon arithmetic over GF(256) for level M, versions 1 to 10.

/** Error correction codewords per block at level M, indexed by version - 1. */
const ECC_PER_BLOCK_M = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26] as const;
/** Number of error correction blocks at level M, indexed by version - 1. */
const BLOCKS_M = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5] as const;

export const QR_MAX_VERSION = 10;

function qrEccPerBlock(version: number): number {
  return ECC_PER_BLOCK_M[version - 1]!;
}

function qrBlockCount(version: number): number {
  return BLOCKS_M[version - 1]!;
}

/** Modules that carry codewords (data and error correction) after the function patterns. */
function qrRawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignCount = Math.floor(version / 7) + 2;
    result -= (25 * alignCount - 10) * alignCount - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

export function qrDataCodewords(version: number): number {
  return Math.floor(qrRawDataModules(version) / 8) - qrEccPerBlock(version) * qrBlockCount(version);
}

/** Centre coordinates of the alignment patterns, ascending. */
export function qrAlignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const alignCount = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + alignCount * 3 + 5) / (alignCount * 4 - 4)) * 2;
  const result = [6];
  for (let pos = version * 4 + 17 - 7; result.length < alignCount; pos -= step) result.splice(1, 0, pos);
  return result;
}

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result: number[] = new Array<number>(degree - 1).fill(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < result.length) result[j] = result[j]! ^ result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result: number[] = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] = result[i]! ^ gfMultiply(coef, factor);
    });
  }
  return result;
}

/** Splits the data codewords into blocks, appends Reed-Solomon codewords and interleaves them. */
export function qrAddEccAndInterleave(data: readonly number[], version: number): number[] {
  const blockCount = qrBlockCount(version);
  const eccLength = qrEccPerBlock(version);
  const rawCodewords = Math.floor(qrRawDataModules(version) / 8);
  const shortBlockCount = blockCount - (rawCodewords % blockCount);
  const shortBlockLength = Math.floor(rawCodewords / blockCount);
  const divisor = rsDivisor(eccLength);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < blockCount; i++) {
    const block = data.slice(k, k + shortBlockLength - eccLength + (i < shortBlockCount ? 0 : 1));
    k += block.length;
    const ecc = rsRemainder(block, divisor);
    if (i < shortBlockCount) block.push(0);
    blocks.push(block.concat(ecc));
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLength - eccLength || j >= shortBlockCount) result.push(block[i]!);
    });
  }
  return result;
}
