sha: 0b367695
files: —
source: primary-source user research, 2026-10-19; linked protocol documentation

# Evaluate external research integration

## Evidence map

The research is qualitative and concentrates on Zotero, Paperpile, DEVONthink and Overleaf. Announcements, author prototypes, feature requests and reports of routine use have different evidentiary weight. Repeated posts by one person are not independent demand.

- [Library access](user-needs/library-access.md): reuse owned PDFs, retrieve personal notes, locate evidence and inspect actual figures.
- [Review workflows](user-needs/review-workflows.md): fill review tables, recover sources and explore references.
- [Write-back](user-needs/writeback-workflows.md): return notes/annotations, organise/import papers and connect an external editor.
- [Usability](user-needs/usability.md): context overhead, result size, setup, runtime reliability and remote-access expectations.

The reports establish tasks worth testing. They do not establish a market size, a final tool list, universal client support or demand for a widget inside a chat.

## Research boundaries

Embedded provider setup and contextual in-app interaction belong to [embedded AI](../../ai-embedded/plan.md). An external agent may already read/edit manuscript files through its own tools; the MCP must demonstrate value from LabShelf-specific retrieval, metadata, annotation or mutation semantics.

The initial read-only experiment compares bounded library access against manual attachment and CLI use. Additional tools and MCP Apps need their own task justification.

## Protocol references

- [Local and remote connections](https://ts.sdk.modelcontextprotocol.io/v2/clients/connect).
- [MCP Apps overview](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html).
- [Advanced tool use and context overhead](https://www.anthropic.com/engineering/advanced-tool-use).

Select a supported protocol revision against the first client's actual behaviour before implementation. Sampling, elicitation, tasks, prompt discovery, subscriptions and authentication require verification against that revision; none is necessary to establish the two read-only product tasks.

Server tool definitions and returned paper contents are separate context costs. Discovery strategies, caching and lazy loading vary by client; measure observed behaviour rather than assuming every client injects every schema into every model turn.
