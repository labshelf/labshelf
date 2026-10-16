sha: 25a7770
files: none (live endpoints)
source: curl of packages.typst.org, 2026-10-16

# Typst Universe index and thumbnails

- Index: GET https://packages.typst.org/preview/index.json, a JSON array of every package version (4,982 entries, 2.3 MB). Headers: `etag`, `cache-control: must-revalidate, max-age=600`, `access-control-allow-origin: *`. Conditional GET with ETag works for the cache.
- Fields: name, version, entrypoint, authors, license, description, repository, homepage, keywords, categories, disciplines, compiler, exclude, updatedAt, template.
- Templates: entries with `template: {path, entrypoint, thumbnail}`. 2,420 versions, 854 distinct names; keep only the highest version per name. Every latest template has `thumbnail` (830 png, 24 webp, a path inside the package).
- Served thumbnails, no download of the package needed: https://packages.typst.org/preview/thumbnails/<name>-<version>-small.webp (~3 KB, for cards) and .../<name>-<version>.webp (~60 KB, for detail). The same URLs the typst.app/universe pages use.
- Package archive: https://packages.typst.org/preview/<name>-<version>.tar.gz, with `access-control-allow-origin: *` and an etag.
- Categories on latest templates: thesis 247, report 234, paper 133, presentation 110, layout 102, cv 89, office 79, book 40, poster 8, others under 30. Mapping to the gallery: paper → Article, thesis → Thesis, poster → Poster, presentation → Slides, cv → CV. The rest (report, book, office, layout...) needs a decision in the contract: an "Other" category, or leave them out.
- Compiler: 79 latest templates declare `compiler` > 0.14.2 (the bundled typst.ts) and 384 declare none. The gallery must mark or hide templates above the bundled compiler. A2 engine warning covers it.
- CORS is open on index, thumbnails and archives, so Q2/Q3's browser concern does not apply to Universe reads.
