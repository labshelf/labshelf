// Declares the CLI's shared vocabulary: the `Output` port commands write through, the usage error they throw, and the --help text.
export interface Output {
  out: (text: string) => void;
  err: (text: string) => void;
  columns: number;
}

export class UsageError extends Error {}

export const USAGE = `LabShelf in the terminal — a paper explorer over your LabShelf library.

Usage:
  labshelf                         open the explorer (TUI)
  labshelf <command> [options]

Library:
  ls [collection] [-r] [--json]    list a collection (-r: everything below it)
  search <query…> [--json]         search the library (tag:x status:reading year:2015..2020 author:x has:pdf)
  show <id> [--json]               details, highlights and reading position of a paper
  add <pdf|folder|url|doi|arxiv>…  import papers [--to <collection>]
  bib [id…] [-c <collection>]      print BibTeX [-o file.bib]
  open <id|key|labshelf:key#pN>    open the PDF (a link opens at its page when the viewer has {page})
  status <id…> <unread|reading|done>
  tag <id…> +tag -tag              add / remove tags
  mv <id…> <collection>            move papers to a collection
  install [project-dir]            import the papers a writing project lists in labshelf.yaml and the library lacks

Sync (Google Drive, shared with the VS Code extension):
  sync                             sync now
  auth login | logout | status     sign in to Google Drive

Setup:
  init [path]                      create or adopt a library and remember it
  where                            print the library, config and log paths
  doctor                           check the setup

Options:
  -L, --library <path>             use this library (else LABSHELF_LIBRARY, else ~/.config/labshelf/config.json)
  --json                           machine-readable output
  -h, --help, -v, --version
`;
