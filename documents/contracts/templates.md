# Contract: project templates

Read when you change how a template is described, listed, downloaded, saved or published.

A template is a set of project files that a new writing project starts from. The gallery lists templates from three sources: the LabShelf Community catalog (a public GitHub repository read through jsDelivr), Typst Universe, and the user's own templates in the library. The Community catalog's CI and every app read the same manifest and index, so changing a key, a path rule or a URL here breaks published templates and the apps already installed.

## Manifest

A template is a folder with `template.yaml` at its root. The project scanner reads only `labshelf.yaml`, so a template is never mistaken for a project.

```
<template id>/
  template.yaml        required
  files/               the project files, copied as they are into the new project
    main.tex
    …
  preview/
    thumbnail.png      first page of the compiled sample
    sample.pdf         the compiled sample
```

```yaml
schema: 1
id: ieee-conference
name: IEEE Conference
description: Two-column conference paper in the IEEEtran class.
category: article
format: latex
engine: pdflatex
main: main.tex
license: LPPL-1.3c
authors: [Jane Doe]
```

| Key | Type | Notes |
|---|---|---|
| `schema` | `1` | required. A higher value refuses the template with "needs a newer LabShelf" |
| `id` | string | required; lowercase ASCII letters and digits in runs joined by single hyphens, at most 64 characters; equals the folder name |
| `name` | string | required; at most 80 characters, one line |
| `description` | string | required; at most 500 characters |
| `category` | `article` \| `thesis` \| `poster` \| `slides` \| `cv` \| `other` | required |
| `format` | `latex` \| `typst` | required |
| `engine` | `tectonic` \| `pdflatex` \| `lualatex` \| `xelatex` \| `typst` | required; `typst` exactly when `format` is `typst` |
| `main` | string | required; a path under `files/` that follows [Paths](#paths), ending in `.tex` for LaTeX and `.typ` for Typst |
| `compiler` | string | Typst only, optional; the lowest Typst version that builds the template, as `<major>.<minor>.<patch>` |
| `license` | string | required; an SPDX license identifier or expression (`MIT`, `CC-BY-4.0`, `MIT OR Apache-2.0`); `NOASSERTION` and `NONE` are refused |
| `authors` | string[] | required, at least one |

Rules:

- A parse error names the key and the reason. Unknown keys are ignored, so a later schema 1 manifest can add optional keys.
- `files/labshelf.yaml` is refused: installing writes the project's `labshelf.yaml` from `format`, `engine` and `main`.
- Installing never runs anything from the template and never enables shell-escape for its builds.
- Community templates must ship both `preview/` files: `thumbnail.png` is a PNG from 400 to 1600 pixels wide, at most 512 KiB, and `sample.pdf` is at most 10 MiB. Both are compiled on the publisher's machine with the declared engine; the catalog never compiles. In My templates `preview/` is optional, and the gallery shows a placeholder without it.

## Paths

Every path in a manifest, an index or a downloaded tree is relative to the template's `files/` folder and is checked on download, on install, on save and on publish. A template that breaks any rule is refused as a whole with a message naming the path, and nothing is written.

- Segments are separated by `/` only. A backslash anywhere is refused.
- No empty segment, no `.` or `..` segment, no leading `/`, no drive letter (`C:`), no control character.
- No file or folder named `latexmkrc` or `.latexmkrc`, and no `.git` segment, at any depth, compared case-insensitively.
- No symbolic link or hard link anywhere in the tree. Archives are checked after extraction, before anything is copied.
- No two paths that differ only in case.
- At most 255 characters per path, 500 files, 5 MiB per file and 20 MiB in all.

## Index

The Community catalog is the repository `labshelf/labshelf-templates`.

```
index.json
templates/<template id>/       one template folder per id, laid out as in Manifest
```

The CI validates every pull request with the same validator the apps use and never compiles. Its `validate.mjs` and `build-index.mjs` are generated from core by `scripts/template-catalog.mjs`, so the CI and the apps share one validator. On `main`, it builds `index.json` from commit `C`, which changed `templates/`, commits it, and purges jsDelivr's copy of `index.json`.

```json
{
  "schema": 1,
  "commit": "3f2c…",
  "templates": [
    {
      "id": "ieee-conference", "name": "IEEE Conference", "description": "…",
      "category": "article", "format": "latex", "engine": "pdflatex", "main": "main.tex",
      "license": "LPPL-1.3c", "authors": ["Jane Doe"],
      "files": [{ "path": "main.tex", "size": 5120, "sha256": "9b1e…" }],
      "thumbnail": { "size": 48213, "sha256": "…" },
      "sample": { "size": 201733, "sha256": "…" }
    }
  ]
}
```

- `commit` is the full commit hash `C` that the index was built from. `templates[]` holds the manifest keys plus the lists above; `files[].path` is relative to `files/`, and `sha256` is lowercase hex.
- An index with `schema` above 1 is refused as a whole and the cached one stays in use. An entry that fails the manifest or path rules, or repeats an earlier entry's `id`, is left out and logged; the others are listed in index order.
- URLs:
  - index: `https://cdn.jsdelivr.net/gh/labshelf/labshelf-templates@main/index.json`, fetched with `If-None-Match`;
  - template file: `https://cdn.jsdelivr.net/gh/labshelf/labshelf-templates@<commit>/templates/<id>/files/<path>`;
  - preview: the same, with `preview/thumbnail.png` or `preview/sample.pdf` in place of `files/<path>`.
- TRAP: jsDelivr caches `@main` for up to 12 hours. Files are fetched at `@<commit>`, which never changes, so an index and its files always match. A download whose size or `sha256` differs from the index is refused with "The catalog is updating, try again later", and nothing is written.

## Typst Universe

Typst Universe templates come from `https://packages.typst.org/preview/index.json`: the entries with a `template` key, keeping the highest version of each `name` (compared as numbers, segment by segment).

| Gallery field | From the Universe entry |
|---|---|
| `id`, `name` | `name` |
| `version` | `version` |
| `description`, `license` | the same keys |
| `authors` | `authors`, each without a trailing `<…>` address or handle |
| `category` | the first of `categories` that maps: `paper` → `article`, `thesis` → `thesis`, `poster` → `poster`, `presentation` → `slides`, `cv` → `cv`; otherwise `other` |
| `format`, `engine` | `typst` |
| `main` | `template.entrypoint`, relative to `template.path` |
| `compiler` | `compiler` |
| thumbnails | `https://packages.typst.org/preview/thumbnails/<name>-<version>-small.webp` (cards) and `…/<name>-<version>.webp` (detail) |

- An entry whose `template.path` or `template.entrypoint` breaks [Paths](#paths) is left out and logged.
- Installing downloads the package into the Typst package cache, the same one the build and Tinymist use, then copies `template.path` from it as the new project's files. The files list is known only once the package is in the cache.
- A template whose `compiler` is newer than LabShelf's bundled Typst can still be installed, and the gallery says which version it needs.

## My templates

The user's own templates live at `<library>/templates/<template id>/`, laid out as in [Manifest](#manifest). A new id is the name folded as a project id is ([library-format.md](library-format.md#labshelfyaml)), unique case-insensitively among My templates.

Saving a project as a template copies the project into `files/` without the build folder, `labshelf.yaml`, `papers:`, `.labshelf/versions/`, `.labshelf/rebuttal/`, `.labshelf/comments.json`, `.labshelf/state.json` and `.labshelf/checklist.json`. It skips `.git/`, and refuses a symbolic link or a `latexmkrc` anywhere in the project with a message naming the path. The manifest's `engine` comes from `labshelf.yaml`, else from the engine the app resolved for the build, and the user gives the authors.

## Cache

Each device keeps catalog data under `<library>/.research/templates/`. It is never synced and can be deleted at any time.

```
.research/templates/
  community/index.json         the last index received, byte for byte
  community/index.etag         its ETag
  community/thumbnails/<sha256>.png
  universe/index.json
  universe/index.etag
  universe/thumbnails/<name>-<version>-small.webp
  universe/thumbnails/<name>-<version>.webp
```

- A `304 Not Modified` keeps the cached index. When the fetch fails, the gallery lists the cached index, and the failure is logged with the URL and the status.
- A cached file that does not parse, or whose `sha256` differs, reads as missing and is fetched again.
- Downloaded template files are never cached: they go through staging into the new project.
