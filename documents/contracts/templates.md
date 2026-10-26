# Contract: project templates

Read when you change how a template is described, listed, downloaded, saved or published.

A template is a set of files a new writing project starts from. The gallery lists three sources: the LabShelf Community catalog (the GitHub repository `labshelf/labshelf-templates`, read through jsDelivr), Typst Universe, and My templates in the library. The catalog's CI and every installed app read the same manifest and index, so a change here can break published templates and apps already installed. Typst Universe and jsDelivr are external and cannot be changed.

## Manifest

Each template is `<id>/template.yaml`, `files/` (copied into the new project), and `preview/thumbnail.png` and `preview/sample.pdf`. Rules:

- `schema` rises only for a change an older app cannot read. A value above the app's own refuses the template, saying it needs a newer LabShelf. Unknown keys are ignored, so the schema can gain optional keys without a bump.
- `files/labshelf.yaml` is refused: installing writes it from `format`, `engine` and `main`.
- Installing runs nothing from the template and never enables shell-escape.
- Community templates ship both previews, compiled by the publisher. In My templates `preview/` is optional.

## Paths

The path rules are checked on download, install, save and publish. One bad path refuses the whole template, naming it, and nothing is written. Beyond the library's relative-path rules they refuse any `latexmkrc` or `.git` segment at any depth, any symbolic or hard link (archives are checked after extraction, before copying), and two paths that differ only in case, because libraries cross operating systems.

## Community catalog

`index.json` and `downloads.json` live in the catalog repository next to `templates/<id>/`. Its CI validates pull requests with the same manifest and path rules the apps use, and never compiles. On `main` it rebuilds `index.json` from the commit that changed `templates/`, commits it and purges jsDelivr's copy. A scheduled job commits `downloads.json` (jsDelivr download counts of each `main` file) and the index build copies each count in; an invalid file fails the build, while an invalid count in the index is dropped.

An index with a `schema` above the app's own is refused and the cached one stays. A bad entry or a repeated id is left out and logged.

TRAP: jsDelivr caches `@main` for hours. The index is fetched from `@main` with `If-None-Match`, so files and previews are fetched at `@<commit>` from the index, which matches it. A download whose size or `sha256` differs is refused with "The catalog is updating, try again later".

## Typst Universe

The gallery reads `https://packages.typst.org/preview/index.json`: entries with a `template` key, highest version per `name`. Installing downloads the package archive, unpacks it in memory and takes the files under `template.path`, so every app installs the same way with or without a disk. Paths and links are checked as above. A `compiler` newer than the bundled Typst still installs, and the gallery says which version it needs.

## My templates

`<library>/templates/<id>/` has the layout above. A new id folds the name as a project id does and is unique case-insensitively. Saving a project as a template copies it into `files/` without build output, `.git/`, `labshelf.yaml`, `.labshelf/` and a `.pdf` next to a `.tex` or `.typ` of the same name. A symbolic link or a `latexmkrc` refuses the save. `engine` comes from `labshelf.yaml`, else the engine the build resolved.

## Publish

Publishing opens a pull request to the catalog. The checks run in order and nothing is sent unless all pass: `manifest` (with the catalog's validator), `license`, `paths`, `latexmkrc`, `sizes`, then `build` with the declared engine and no shell-escape, then `thumbnail` (the first built page, within the preview limits). A failure in the first two groups skips the build and the thumbnail. The submission commits `templates/<id>/` to the branch `template/<id>-<YYYY-MM-DD>` (UTC) of the fork `POST /forks` returns, opens the pull request against upstream `main`, then saves the same files and previews into My templates. In the browser, [LabShelf Helper](helper.md) builds and submits a snapshot of the saved sources, the page renders the thumbnail, and GitHub is authorized through Device Flow.

## Cache

`<library>/.research/templates/` holds `community/` and `universe/`, each with `index.json` (byte for byte), `index.etag` and `thumbnails/`. It is never synced and can be deleted. A `304` or a failed fetch keeps the cached index. A cached file that fails to parse or to match its `sha256` is fetched again. Downloaded template files are never cached.
