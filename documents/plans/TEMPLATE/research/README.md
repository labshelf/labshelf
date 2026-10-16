# Research entries

One file per area a scout covered, named `<area>.md`, body at or under 4,000 characters. Each entry opens with this header, before the first heading:

```
sha: <commit the facts were read at>
files: <comma-separated paths or globs the facts depend on>
source: <scout, URL or doc the facts came from>
```

`node scripts/research-fresh.mjs` prints `fresh <path>` or `stale <path> — <reason>` per entry. A stale entry is re-scouted before an implementer relies on it; a fresh one goes into the implementer's brief as is. An entry without `files:` (external docs) counts as fresh.

Delete this README in the real plan.
