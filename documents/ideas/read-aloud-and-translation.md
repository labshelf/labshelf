# Read aloud and translation

The reader speaks a paper aloud and translates it, in any of the three apps, for free and without sending the paper anywhere. Both features run on open models on the user's machine: no account, no API key, no quota. Papers whose text comes from LabShelf's OCR work the same way as born-digital ones.

## What the user gets

- **Read aloud.** Play from the selection, from the paragraph under the cursor or from the top of the page. The reader highlights the sentence being spoken and scrolls with it. Pause, resume, skip to the previous or next sentence, change speed and voice.
- **Translate selection.** Select text, choose Translate, and a popover shows the translation, with Copy and Read aloud.
- **Translate paper.** A translated view of the whole paper, paragraph by paragraph, beside the original or interleaved with it. The visible pages translate first, and the rest continues in the background with a progress indicator.
- **Read the translation aloud.** Read aloud works on the translated view too, so a user can listen to an English paper in Portuguese.

The UI follows [product.md](../product.md): core components, core tokens, core icons, and the words paper and folder.

## Text source

Both features read the same text the reader already builds: the pdf.js text layer turned into reading-order lines by `packages/core/src/reader/`. That code already handles two-column layouts, sideways margin stamps, captions, float regions and the reference list, so read aloud and translation reuse it and never parse the PDF themselves.

On top of the lines, a small core step builds **speakable paragraphs**:

- joins words hyphenated across lines;
- drops running headers, footers and page numbers;
- skips display math, tables and the reference list (math and tables have no useful spoken or translated form);
- keeps in-text citations as text in translation but skips them in speech, so "[12, 14]" is not read out;
- splits each paragraph into sentences, which are the unit of highlighting and of translation requests.

Each sentence keeps the page and text-item range it came from, so highlighting and "jump to original" map back onto the PDF.

## Papers with an OCR layer

LabShelf's OCR (`packages/core/src/import/node/ocr/`) writes Tesseract's recognised text into the PDF as an invisible text layer. pdf.js reads that layer like a born-digital one, so read aloud and translation need no separate path for OCR papers.

What differs is the quality of the input:

- a word the OCR misread is spoken and translated wrong;
- OCR'd math and tables are noise, so the skipping rules above matter more;
- stray characters at page edges are already filtered by the OCR debris handling in the text lines.

The paper's text-layer verdict records whether its text is native or OCR. When it is OCR, the translated view and the read-aloud bar show a short note that the text comes from OCR and may contain errors. A paper with no text layer offers OCR first, as it does for search.

## Engines

All engines are free, open source and run locally. Each one is chosen per app by what that runtime can run.

### Speech

| Engine | Quality | Languages | Runs in | Cost to the user |
|---|---|---|---|---|
| Web Speech API (`speechSynthesis`) | OS voices: robotic to good (macOS Premium voices are good) | whatever the OS has | VS Code webview, browser pages | nothing |
| `chrome.tts` | OS voices, plus Google network voices in Chrome | many | browser extension | nothing |
| Piper (ONNX, MIT) | neural, natural | many, including Brazilian Portuguese | WASM in webviews and pages, native CLI in the terminal | voice download of tens of MB, once |
| Kokoro-82M (`kokoro-js`, Apache 2.0) | neural, the most natural of these | English in `kokoro-js` | WASM or WebGPU in webviews and pages, Node | model download of about 160–330 MB, once |
| `say` (macOS), `espeak-ng` | OS voice, or robotic | many | terminal | nothing |

A neural voice is produced by a network trained on human speech, so rhythm, pauses and intonation sound like a person reading. The OS voice is the default because it costs nothing and starts instantly. Piper and Kokoro are optional voices the user downloads from settings.

### Translation

| Engine | Quality | Runs in | Cost to the user |
|---|---|---|---|
| Bergamot (the Firefox Translations engine, Marian models compiled to WASM) | en→pt BLEU 49.75 against Google's 50.70 on WMT test sets | webviews, browser pages, Node | about 20 MB per language pair, once |
| Chrome Translator API | comparable, on-device | Chrome only, not VS Code webviews | nothing |

Bergamot is the engine for every app, because one core implementation runs in all three runtimes. Its WASM build needs SIMD (SSE4.1 on x86), which every recent machine has. Its models are trained on general text, so scientific terminology translates worse than the BLEU score suggests; a per-user glossary of terms to keep or translate in a fixed way softens that.

Cloud services (DeepL Free, Google) and LLM-based translation are out of scope: they send the paper away or need a key, which goes against local-first.

## Layout-preserving translated PDF

A translated PDF with the original layout, formulas and figures in place is what BabelDOC and PDFMathTranslate-next produce. Both are Python tools that translate with a large language model, so a free run needs a local model through Ollama, a lot of memory and, in practice, a GPU. LabShelf does not embed them. If it is ever wanted, it is an export in the terminal app that calls the tool the user installed, with the result saved as an attachment in the paper's folder.

## Architecture

Placement follows [architecture.md](../architecture.md):

- **core, runtime-neutral:** the speakable-paragraph builder, sentence splitting, the glossary, the translation job (order, progress, cancellation, cache lookup) and two ports: `ISpeechSynthesizer` (speak a sentence, report boundaries, stop, list voices) and `ITranslator` (translate a batch of sentences between two languages, list installed pairs).
- **core `dom/`:** the read-aloud bar, the sentence highlight, the translation popover and the translated view, inside the shared reader. Also the Web Speech, Piper-WASM and Kokoro adapters, because they run in both VS Code webviews and browser pages.
- **core, Bergamot:** the Bergamot adapter runs in a worker, so it is used from `dom/` pages and from `node/` alike; only the worker bootstrap differs per runtime.
- **vscode:** wires the `dom/` adapters into the reader webview and stores models in the device cache.
- **browser:** wires the same adapters, plus a `chrome.tts` adapter, and stores models in the Origin Private File System.
- **terminal:** a `say`/`espeak-ng`/Piper-CLI adapter and a plain-text translated view in the preview pane.

The reader asks its host for models and cached translations through new messages in the reader protocol (core `reader/protocol`).

## Storage

Translations and models are rebuildable, so they are device-local and never synced. They live in the cache directory of [contracts/library-format.md](../contracts/library-format.md#device-local-files):

```
<cache dir>/libraries/<library key>/
  translations/<paper id>/<source>-<target>.json   sentences translated so far, keyed by the PDF's content hash and the engine and model version
<cache dir>/models/
  translation/<pair>/                              Bergamot models
  speech/<voice>/                                  Piper and Kokoro voices
```

A cached translation whose PDF hash, engine or model version does not match is discarded, and the paper translates again. The glossary is user data, so it lives in the shared configuration and syncs. Both files are on-disk formats, so they enter the contract when this is built.

## Downloads, privacy and failure

- A model downloads only when the user picks a voice or a language pair, with its size shown before the download starts. Downloads verify a checksum, resume after a failure and can be deleted from settings.
- After the download, nothing leaves the machine. The settings say so.
- A failed engine logs through `ILogger` with the paper id, the engine, the model and the sentence index, and the UI says which step failed. Read aloud falls back to the OS voice when a neural voice fails to load, and logs the fallback.

## Accessibility

- Every control has a keyboard shortcut and an accessible name; the read-aloud bar is reachable by Tab.
- The sentence highlight uses a token colour with enough contrast in every theme, and scrolling with it respects reduced motion.
- Read aloud never conflicts with a screen reader: it pauses when the user starts the screen reader's own reading.

## Performance to measure first

Published numbers are thin, so the first step is a measurement on real papers, born-digital and OCR'd:

- **Speech:** real-time factor (synthesis time divided by audio length) for Piper and Kokoro, WASM and WebGPU, after warm-up. One unsourced benchmark puts Piper medium at about 0.11 on a laptop (about 9× real time); Kokoro has no published browser number.
- **Translation:** sentences per second for Bergamot WASM on a two-column paper, and the time to the first translated page.
- **Quality:** a read of a few translated abstracts and methods sections by the user, OCR'd ones included.

## First slice

1. Translate selection with Bergamot, en↔pt, in the VS Code and browser readers.
2. Read aloud the selection and the current paragraph with the OS voice, with the sentence highlight.
3. The measurement above, which decides whether Piper or Kokoro is worth the next slice.

Translate paper, the translated view, the terminal and the glossary follow.

## Open questions

- Whether `speechSynthesis` exposes the OS voices inside a VS Code webview on every platform (Linux needs speech-dispatcher).
- Whether the translated view replaces the PDF beside the original or overlays the translation on the page.
- How abbreviations, units and symbols ("et al.", "Fig. 3", "μm") are spoken; Piper and Kokoro need a text normaliser for them.
- Whether Kokoro's size is worth it next to Piper, given that `kokoro-js` has no Portuguese voice.
