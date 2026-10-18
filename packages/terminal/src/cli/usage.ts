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

Writing:
  install [project-dir]            import the papers a writing project lists in labshelf.yaml and the library lacks
  build [project] [--watch]        build a project's PDF (--watch: rebuild on source changes until Ctrl-C)
  cite [project] [--format latex|typst|key]  pick a paper and print its citation
  projects [--json]                list the library's writing projects
  check [project] [--json]         check a project's built PDF and sources before submitting

Setup:
  init [path]                      create or adopt a library and remember it
  move <path>                      move the library to another folder (a non-empty folder gets a LabShelf subfolder)
  sync-help                        how to sync the library between computers
  conflicts                        list and resolve conflicting copies left by a sync tool
  where                            print the library, config and log paths
  doctor                           check the setup
  bridge install|status|uninstall  connect the browser extension to the library (installs the native messaging host)
  helper install|status|uninstall  let the browser extension build LaTeX with this app (--replace takes over from LabShelf Helper)

Options:
  -L, --library <path>             use this library (else LABSHELF_LIBRARY, else ~/.config/labshelf/config.json)
  --json                           machine-readable output
  -h, --help, -v, --version
`;
