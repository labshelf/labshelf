# Code facts database

`analysis/labshelf.db` is a SQLite database of facts about the product code of `packages/core`, `packages/vscode` and `packages/browser` (`src/` only; tests, `__tests__/` and `*.test.ts` are left out). It is the input for [reorganization.md](reorganization.md) and [typing.md](typing.md). The database is git-ignored. Rebuild it from the current source in about 20 seconds:

```sh
sh analysis/scripts/run.sh
```

| Script | Writes |
|---|---|
| `scripts/extract.mjs` | `files`, `dirs`, `units`, `params`, `calls`, `args`, `imports`, `import_names`, `file_edges`, `types`, `values`, `type_escapes` |
| `scripts/clones.mjs` | `clone_families`, `clone_members`, `clone_pairs`, `homonyms` |
| `scripts/typeShapes.mjs` | `type_pairs` |
| `scripts/effects.mjs` | `units.effects_transitive` |
| `scripts/typing.mjs` | `value_concepts` |
| `scripts/typingReport.mjs` | nothing; prints the aggregates behind [typing.md](typing.md) |
| `scripts/communities.mjs` | `communities`, `community_summary` |
| `scripts/validate.mjs` | nothing; exits 1 when a control fails |
| `scripts/lib.mjs` | shared: TypeScript loader, unit detection, normalized token stream |

The scripts use the TypeScript 6 compiler API (the repo's TypeScript 7 has no JS API; pnpm keeps a 6.x copy for typescript-eslint) and Node's built-in `node:sqlite`. `extract.mjs` builds one program over all three packages, so a call from `vscode` into `core` resolves to the core unit.

Query it with any SQLite client, for example `sqlite3 analysis/labshelf.db`.

## Schema

All paths are repo-relative (`packages/core/src/...`).

### files
One row per source file.

| Column | Meaning |
|---|---|
| `path`, `package`, `dir`, `name` | location; `package` is `core`, `vscode` or `browser` |
| `domain` | `<package>/<first folder under src>`, or `<package>/(root)` |
| `lines`, `units`, `exported_units` | line count, units declared in the file, units that are exported (`units.exported > 0`) |
| `runtime` | core: `neutral`, `node`, `dom`, `worker` (`relay/worker/`); vscode: `vscode-host`, `node` (`node/` folders and `extension.ts`), `webview`; browser: `worker` (`background/`), `content-script` (`content/`), `dom` (everything else) |
| `is_barrel` | 1 for an `index.ts` that only imports and re-exports |
| `fan_in`, `fan_out` | distinct product files that use a declaration of this file / whose declarations this file uses, resolved through barrels to the declaring file (`file_edges`) |

### dirs
One row per directory under `packages/<pkg>/src` that holds a source file at any depth.

| Column | Meaning |
|---|---|
| `path`, `package`, `depth` | `depth` 0 is `src` itself |
| `files`, `subdirs`, `lines` | direct source files, direct subdirectories, lines of the direct files |
| `files_recursive`, `lines_recursive` | the same over the whole subtree |
| `median_file_lines` | median size of the direct files |

### units
Every function with a body: function declarations, arrows, function expressions, methods, constructors, getters and setters.

| Column | Meaning |
|---|---|
| `id`, `file`, `start_line`, `end_line`, `lines` | location |
| `name`, `kind`, `owner`, `context` | `name` is the declared, variable or property name, or `<anon>@line:col`; `owner` is the class or object-literal variable for members; `context` is `arg of <callee>` for callbacks |
| `exported` | 0 private, 1 exported from its module, 2 public member of an exported class |
| `nodes` | normalized AST nodes of parameters and body: no comments, whitespace, parentheses, type annotations or decorators |
| `statements`, `param_count`, `parent_id` | top-level statements of the body; parameters; enclosing unit for nested functions |
| `signature`, `return_type` | from the type checker (`(paperId: string, ...): T`) |
| `calls` | JSON array of called names (last segment of the callee) |
| `imports_used` | JSON array of `<module>:<local name>` for imported bindings used in the unit or its nested units |
| `effects` | JSON array, heuristic: `fs`, `spawn`, `net`, `os`, `node-path`, `node-crypto`, `sqlite`, `vscode`, `browser-ext`, `dom`, `storage`, `process`, `timer`, `console`, `clock`, `message`, `worker`, `vscode-webview`, `node` (a method on a `@types/node` type), `port:<Name>` (a method on a `core/src/ports` interface). Effects of nested units count for their parents. Direct only: `[]` means "no effect of its own", not "pure" |
| `effects_transitive` | `effects` plus `iface:<Type>` for each call through a method declared on a product interface or type (injected ports and deps objects anywhere, not only `core/src/ports`), plus the effects of every resolved callee, to a fixed point. Use this to find pure helpers |
| `t1`, `t2` | hash of the normalized token stream; `t2` renames unit locals by first appearance |

### params
`unit_id`, `idx`, `name` (destructured parameters keep their source text), `type` (checker), `declared_type` (source text or null), `optional`.

### calls, args
`calls`: one row per call or `new` inside a unit. `caller_id`; `callee_id` when the callee resolves to a product unit (through imports, barrels and `const f = () => …`); `callee_name` (`receiver.method` as written); `callee_file` (product path, `external` for `node_modules`, null for globals and lib types); `callee_kind` (declaration kind, e.g. `MethodSignature` for a call through an interface); `receiver_type`; `file`, `line`, `is_new`.

`args`: for calls with a resolved `callee_id`, one row per argument that is a name: `idx`, `param_name`, `param_type`, `arg_name` (identifier, last property of `a.b.c`, string key of `a["k"]`, or `f()`), `arg_text`, `arg_type`.

### imports, import_names, file_edges
`imports`: one row per `import` or `export … from`. `from_file`, `specifier`, `to_file` (product file or null), `external` (package specifier), `kind` (`import` or `reexport`), `type_only`, `names` (JSON), `line`.

`import_names`: one row per named binding. `via_file` is the file the specifier points at (often a barrel); `decl_file` is where the symbol is declared after following re-exports; `decl_kind` is its declaration kind.

`file_edges`: distinct `from_file → to_file` dependency pairs resolved to the declaring file; `fan_in` and `fan_out` count them.

### types, type_pairs
`types`: every interface, type alias and enum. `name`, `file`, `kind`, `exported`, `line`, `generic`, `members` and `member_names` (JSON, sorted), `shape` and `shape_hash`. For object-like types (interfaces, type literals, intersections, `Pick`/`Omit`/`Partial`/`Required`/`Readonly`) `shape` is `{name?:type;...}` sorted, with the member types from the checker; unions are their sorted members; enums are their sorted `member=value` pairs; other aliases are the source text without whitespace. Equal `shape_hash` means structurally equal.

`type_pairs`: object-like types with at least 3 members whose member names overlap with Jaccard ≥ 0.8. `name_sim` compares names only, `typed_sim` compares `name:type`, `same_hash` marks identical shapes.

### values
Every parameter, interface or type-literal field and class field whose name names a domain concept. `name`, `concept`, `kind` (`param`, `field`, `class-field`), `owner` (unit or type), `file`, `package`, `line`, `type` (checker), `declared_type`, `is_primitive` (`string`, `number`, optionally with `| undefined` or `| null`), `unit_id`.

`concept` is the matched suffix, lower-cased and singular: `id`, `path`, `url` (also `uri`), `key`, `doi`, `hash`, `dir`, `root`, `folder`, `file`, `name` (only as a suffix, like `folderName`), `slug`, `token`, `sha`, `etag`, `rev`, `email`, `arxiv`, `isbn`. The finer concept (`paperId` vs `folderId`) is in `name`; group by `lower(name)`.

### value_concepts
One row per `values` row: `value_id`, `fine` (the finer concept, e.g. `paperId`, `projectRelPath?`, `webUrl`; a trailing `?` marks a guess), `basis` (`name` when the name says it, `domain` when a bare `id`/`path`/`file`/`key`/`root`/`url` was assigned by its domain folder, which is a judgement), `collection` (1 for arrays and sets).

### type_escapes
`file`, `line`, `kind`, `text`, `unit_id`. Kinds: `any`, `unknown` (as a type, not `as unknown`), `as`, `as-unknown-as`, `as-const`, `non-null` (`x!`).

### clone_families, clone_members, clone_pairs
| Tier | Rule | `precision` |
|---|---|---|
| `T1` | identical normalized tokens, ≥ 20 nodes | reliable |
| `T2` | identical once unit locals are renamed, ≥ 30 nodes, and not all members share one `t1` | reliable |
| `near` | Jaccard ≥ 0.8 on 4-shingles, ≥ 30 nodes, linked by union-find | warning |
| `inline` | identical T2 window of 2–6 consecutive statements in different places, ≥ 15 nodes | warning |
| `name-variant` | same free-function name (no class or object owner) in ≥ 2 files, ≥ 10 nodes, identical at any size or Jaccard ≥ 0.6, and not already one unit-tier family | review |

The shingles for `near` and `name-variant` replace every unit local with one `$`. With numbered placeholders, one extra parameter shifts every later name: two copies of `isInside` that differ only by an injected `PathOps` score 0.14 instead of 0.64.

`clone_families`: `tier`, `precision`, `members`, `files`, `packages`, `distinct_names`, `names` (first 12), `nodes_min`, `nodes_max`, `sim_min`, `sim_max`, `redundant` (1 when every member is nested in a member of another family), `hash`.

`clone_members`: `family_id`, `unit_id`, `file`, `start_line`, `end_line`, `name`, `nodes`; for `inline` also `stmt_start`, `stmt_len` and `whole_body` (the window is the unit's entire body).

`inline` keeps only maximal windows (a window whose every copy extends to one more matching statement is dropped) and drops windows already inside a unit-tier family. `clone_pairs` holds the pairwise similarity for `near` and `name-variant`.

### homonyms
Every free-function name declared in ≥ 2 files. `units`, `files`, `packages`, `exported` (how many copies are exported), `pairs`, `identical_pairs` (same `t1` or `t2`), `variant_pairs` (Jaccard ≥ 0.6), `max_sim`, and `verdict`: `identical` (all copies the same), `identical-subset` (some copies the same, none merely similar), `variant` (similar copies that differ), `different` (no pair is similar: same name, different code).

### communities, community_summary
Louvain modularity clustering of the undirected file graph. The edge weight is the number of imported names (resolved to the declaring file) plus the number of resolved calls between the two files. Barrels are left out. `scope` is `core`, `vscode`, `browser` (the package alone) or `all`. `level` 0 is the finest partition; the highest level stored is the final one.

`community_summary`: `files`, `lines`, `units`, `dirs` (distinct directories), `top_dirs` (JSON `[dir, files]`, top 4), `dir_purity` (share of files in the top directory), `internal_weight`, `external_weight`, `packages`.

## Controls

`scripts/validate.mjs` checks that the known duplicate helpers form families and that a known homonym with different behaviour does not:

| Name | Expected | Result |
|---|---|---|
| `exists` | family | T1 families (2 and 3 copies) |
| `hostOf` | family | `name-variant`: two identical 15-node copies, below the T1 size floor |
| `isInside` | family | `name-variant`: three copies, similarity 0.63–0.64, different semantics |
| `readJson` | no family | none; best pair 0.49 |

The margin is thin: the `name-variant` threshold of 0.6 sits between `isInside` (0.63) and `readJson` (0.49). Treat `name-variant` as a list to read, not as proof.

## Example queries

1. Directories of many small files (fragmentation):
   ```sql
   SELECT path, files, lines, median_file_lines FROM dirs
   WHERE files >= 4 ORDER BY median_file_lines, files DESC LIMIT 20;
   ```
2. Pass-through directories that hold only one subdirectory:
   ```sql
   SELECT path, files_recursive, lines_recursive FROM dirs
   WHERE files = 0 AND subdirs = 1 ORDER BY lines_recursive;
   ```
3. Reliable clone families with every copy's location:
   ```sql
   SELECT f.tier, f.members, f.nodes_min, f.names,
          GROUP_CONCAT(m.file || ':' || m.start_line, ' ') AS sites
   FROM clone_families f JOIN clone_members m ON m.family_id = f.id
   WHERE f.precision = 'reliable' AND f.redundant = 0
   GROUP BY f.id ORDER BY f.nodes_min * f.members DESC;
   ```
4. Helper names declared in several files whose copies are the same or similar:
   ```sql
   SELECT h.name, h.units, h.verdict, h.max_sim,
          GROUP_CONCAT(u.file || ':' || u.start_line, ' ') AS sites
   FROM homonyms h JOIN units u ON u.name = h.name AND u.owner IS NULL
     AND u.kind IN ('function', 'arrow', 'function-expr')
   WHERE h.verdict <> 'different' GROUP BY h.name ORDER BY h.units DESC;
   ```
5. Who calls each copy of a duplicated helper:
   ```sql
   SELECT u.file AS copy, c.file AS caller, c.line
   FROM calls c JOIN units u ON u.id = c.callee_id
   WHERE u.name = 'isInside' ORDER BY u.file;
   ```
6. Private pure helpers about URLs (candidates for a shared module):
   ```sql
   SELECT file, name, signature FROM units
   WHERE exported = 0 AND kind IN ('function', 'arrow') AND effects_transitive = '[]'
     AND (calls LIKE '%"URL"%' OR signature LIKE '%Url: string%');
   ```
7. Functions with two or more `string` parameters (argument-swap risk):
   ```sql
   SELECT u.file, u.name, u.signature, COUNT(*) AS string_params
   FROM units u JOIN params p ON p.unit_id = u.id
   WHERE p.type = 'string' GROUP BY u.id HAVING COUNT(*) >= 2
   ORDER BY string_params DESC;
   ```
8. Calls that pass one kind of id where another is expected:
   ```sql
   SELECT a.param_name, a.arg_name, c.callee_name, c.file, c.line
   FROM args a JOIN calls c ON c.id = a.call_id
   WHERE a.param_name GLOB '*[a-z]Id' AND a.arg_name GLOB '*[a-z]Id'
     AND lower(a.param_name) <> lower(a.arg_name);
   ```
9. Structurally identical types declared in different places:
   ```sql
   SELECT shape_hash, COUNT(*) AS n, GROUP_CONCAT(name || ' @ ' || file, ' | ') AS decls
   FROM types WHERE members >= 3 GROUP BY shape_hash HAVING n > 1 ORDER BY n DESC;
   ```
10. Call/import communities that cut across many directories:
    ```sql
    SELECT community, files, lines, dirs, dir_purity, top_dirs FROM community_summary
    WHERE scope = 'core' AND level = 0 AND files >= 5 ORDER BY dir_purity;
    ```

## What the facts do not cover

- Only `core`, `vscode` and `browser` product code. `packages/terminal`, the website, CSS, HTML and tests are left out, so a helper used only by the terminal or a test counts as unused here.
- `effects` is a heuristic over imported modules, a list of globals and the declaring file of a method's receiver type; a port call is seen only when the receiver is typed as a `core/src/ports` interface. `effects_transitive` closes both gaps through resolved calls, but calls that stay unresolved (callbacks, handler maps) carry nothing, and `iface:` also marks pure injected operations such as `PathOps`. Of 10,028 units with no direct effect, 3,976 have one transitively (1,842 of them private free functions).
- `calls` resolves only static callees. Calls through callbacks, maps of handlers and dynamic dispatch on unions stay unresolved (`callee_id` null).
- `values` matches names, not meaning: `file` may be a path or a `File` object, `key` may be a cite key, a storage key or a map key.
- Clone tiers compare syntax. Two units with different code and the same behaviour are not found, and `name-variant` only looks at same-named functions.
- The repeated-name count differs from earlier measurements (this database counts 337 free-function names in ≥ 2 files, 275 of them never exported), because it counts free functions only and runs after the `refactor/naming` merge.
