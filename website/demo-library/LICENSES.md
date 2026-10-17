# Demo library licences

The papers in this library are redistributable: each one is licensed on its arXiv abstract page (checked 2026-10-17) under CC BY 4.0 (`creativecommons.org/licenses/by/4.0`), which allows copying and redistribution with attribution. `metadata.yaml` keeps the authors, title and abstract URL as attribution.

| Paper id | arXiv id | Licence |
|---|---|---|
| `touvron2023llama` | 2302.13971 | CC BY 4.0 |
| `jiang2023mistral` | 2310.06825 | CC BY 4.0 |
| `dettmers2023qlora` | 2305.14314 | CC BY 4.0 |
| `wei2022chainofthought` | 2201.11903 | CC BY 4.0 |
| `wang2022selfconsistency` | 2203.11171 | CC BY 4.0 |
| `yao2022react` | 2210.03629 | CC BY 4.0 |
| `bai2022constitutional` | 2212.08073 | CC BY 4.0 |
| `rafailov2023direct` | 2305.18290 | CC BY 4.0 |
| `veen2023adapted` | 2309.07430 | CC BY 4.0 |

`projects/llm-reasoning-notes/refs.bib` cites `chen2023benchmarking` (arXiv 2305.16326, CC BY 4.0) as a preprint only; it is not in the library, and Nature Communications published it as DOI 10.1038/s41467-025-56989-2.

## What is committed

Only `papers/Language models/Reasoning/wei2022chainofthought/paper.pdf` (arXiv v6, text-based, with a references section) is in the repository. `website/tools/fetchDemoLibrary.mjs <dest>` copies this folder to `<dest>` and downloads the other PDFs from arXiv.

`veen2023adapted` is the arXiv preprint of a paper published in Nature Medicine (DOI 10.1038/s41591-024-02855-5), which makes it the demo of Find Published Version.
