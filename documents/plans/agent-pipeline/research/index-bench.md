# Index bench (2026-10-28)

sha: b50fbe28 (main, `scripts/code/` committed)
files: scripts/code/facts.mjs, extract.mjs, tokens.mjs, lib.mjs, embed.mjs, moduleMap.mjs
source: bench 2 run outside the repo (headless `claude -p --model sonnet`, explorer system prompt, 150 runs)

## Setup

30 needle tasks: find an existing function. 15 private, 15 exported; 20 by a plain-words behaviour description, 10 by the function's body with locals renamed. Each task × 5 explorer variants, scored on `ANSWER: path:line name` (line ±3, copies accepted). A scorer bug on `Owner.method` names was fixed before the final numbers.

| Variant | Tools | Found | Mean $ | Turns |
|---|---|---|---|---|
| A | grep only | 30/30 | 0.058 | 4.3 |
| B | `facts find|module|callers|uses|tests|tags|sql` | 30/30 | 0.056 | 4.0 |
| C | B + `facts fn` (all units, private included) | 30/30 | 0.057 | 3.9 |
| D | C + `facts similar` (4-shingle Jaccard, flat locals) + `facts sig` | 30/30 | 0.054 | 3.4 |
| E | D + local embeddings (bge-small, `@huggingface/transformers`) | 30/30 | 0.053 | 3.3 |

Median paired cost ratio vs A: D 0.91, E 0.94. On snippet tasks D and E cut turns 3.2 → 2.3 and tokens by 21 %.

## Findings

- Accuracy is not the problem: grep alone finds every needle. The index only saves turns.
- About 85 % of each scout's tokens are fixed: median 47k cache-read system prompt against 586 output tokens. Index tuning can only shave the variable ~15 %. The big saving is to not spawn a scout: a direct `facts fn|similar|sig` call in the main thread or implementer costs a few hundred tokens instead of ~47k.
- Embeddings (E) add no accuracy and little cost gain over the deterministic layer (D); an earlier qualitative test showed the same. The model misses vocabulary-gap queries (e.g. "wait between downloads to the same site" vs `hostPacer`). So: no ollama, no transformers dependency, nothing that needs a model.
- The module map (`moduleMap.mjs`) raised cost by 33 %: scouts read it instead of querying. Removed.
- `facts similar` finds renamed copies by structure (T1/T2 hash or Jaccard ≥ 0.8 on flat-normalized 4-shingles). This is the strongest lever against duplicates: run it when code is written, not when a scout is asked.

## Timing (warm DB, 9,464 units)

- `facts similar --file … --lines …`: 0.11 s; snippet on stdin (loads TypeScript): 0.18 s.
- Full extract with the TypeScript checker: ~5 s; git post-commit, post-merge and post-checkout hooks (`installHooks.mjs`) rebuild in the background.
- Scope: `packages/*/src` and `packages/*/__tests__` only; `scripts/` is not indexed (use `rg`).

## Why not `scripts/ctx` (oxc-parser + ollama)

The planned index duplicated what `scripts/code` already does with the type checker (signatures, resolved imports through barrels, calls, private units), and its only extra was ollama embeddings, which the bench shows are not worth a dependency.
