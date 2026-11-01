// The deck vocabulary of documents/contracts/decks.md as the one-sentence rules deck_rules returns.

export const DECK_VOCABULARY: readonly string[] = [
  "A deck lives in talks/<name>/deck.html or posters/<name>/deck.html with theme.css beside it; no other folder holds a deck.",
  "A deck name is lower-case letters, digits and hyphens, starting with a letter or digit, at most 64 characters.",
  'The root element is <html data-deck="talk|poster" data-deck-version="1" data-deck-size="<w>x<h><unit>">, with px for talks and mm or in for posters.',
  'The head holds exactly one <link rel="stylesheet" href="theme.css" data-deck-theme>.',
  "Slides are <section data-slide> direct children of body; a poster has exactly one slide.",
  'Blocks are direct children of a slide with data-block="<id>" (id starts with a letter, then letters, digits or hyphens, at most 40 characters, unique in the deck).',
  "A block's inline style holds left, top, width and height in px with at most 2 decimals; other declarations there are free.",
  "Speaker notes are one <aside data-notes> direct child of a slide.",
  "Math is <span data-math>TeX</span> or <div data-math=\"display\">TeX</div> holding TeX source.",
  "Text is edited in leaves: elements inside a block whose children are only text, <br>, phrasing elements (a b i em strong u s sub sup small mark code span) or math.",
  "Inside a block HTML and CSS are free, except scripts, event handlers and external references, which the rules below refuse.",
  "Assets are files inside the deck folder (suggested assets/), referenced by relative paths that stay inside it, at most 5 MB each.",
  "Errors refuse a write and return the diagnostics; warnings never block a write.",
];
