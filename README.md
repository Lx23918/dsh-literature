# DSH Literature

[![CI](https://github.com/Lx23918/dsh-literature/actions/workflows/ci.yml/badge.svg)](https://github.com/Lx23918/dsh-literature/actions/workflows/ci.yml)

English | [简体中文](README.zh.md)

A native literature manager for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Organize local PDFs, search their contents, discuss selected papers using your existing DSH model, and follow verified quotations back to the source page.

No separate Zotero installation or model API proxy is required. The interface is currently in Chinese; both English and Chinese documentation are provided.

## What it does

| Task | Features |
| --- | --- |
| Build a library | Copy PDFs into managed storage; import folders as nested collections; reuse identical PDFs by content hash. |
| Identify papers | Extract local PDF metadata; optionally match DOI/title/arXiv records through Crossref and arXiv. |
| Find evidence | Local SQLite FTS5 keyword search, physical PDF page numbers, and word coordinates. |
| Read with AI | Create a research session restricted to the papers you selected, using DSH's native model picker, streaming responses and history. |
| Check quotations | Match a quotation against the local PDF, record its content fingerprint, and open the matching page with highlights. |
| Write references | Stable/pinned citation keys, BibTeX/BibLaTeX/CSL JSON export, LaTeX/Pandoc quick copy, and auto-updating `.bib` files. |
| Organize reading | Collections, tags, journal labels, notes, recoverable trash and optional easyScholar journal metrics. |

Quotation verification confirms that text exists in the cited PDF. Assessing whether it supports a conclusion still requires reading the surrounding context.

<details>
<summary>Evidence-reader demo (synthetic paper)</summary>

<img src="docs/images/evidence-reader.png" width="540" alt="A synthetic quotation highlighted on PDF page 2 in the DSH evidence reader">

This sample uses a generated test document, no private account/paper and no model request.
</details>

## Requirements

- **DSH 0.2.1-rc.2**: the version this release was developed and checked against. Other versions are not covered by that compatibility claim.
- **Node.js 24.13 or newer**, normally supplied by DSH.
- **Python 3.10+** with the PDF dependency in `requirements.txt`:

  ```sh
  python -m pip install -r requirements.txt
  ```

On systems where Python is named `python3`, use `python3` instead. The executable must be available to the process that launches DSH. See [Python configuration](#python-configuration) when it is not on that process's PATH.

## Install from source

```sh
git clone https://github.com/Lx23918/dsh-literature.git
cd dsh-literature
python -m pip install -r requirements.txt
npm ci
npm run build
dsh plugin --profile desktop add .
```

Use the profile you actually run in place of `desktop`, if different. Restart DSH after installation. A **文献库** (Literature) entry appears in the sidebar. The source directory remains the installed plugin location; keep it available.

Release archives are available from [GitHub Releases](https://github.com/Lx23918/dsh-literature/releases). This project does not publish a separate model subscription service, and installation does not log in to any model provider.

### Python configuration

The plugin uses `DSH_LITERATURE_PYTHON` when set; otherwise it uses `python` on Windows and `python3` elsewhere. You can also set the interpreter in your profile's `cordis.patch.yml`:

```yaml
- id: literature-library-service
  config:
    python: python3
```

Replace the value with your interpreter's absolute path if necessary. Preserve any other options already present in this entry. Configure the environment for the DSH process, rather than only for an unrelated terminal window.

## Start reading

1. Open **文献库** and choose **导入 PDF** or **导入文件夹**.
2. Select papers and choose **索引所选** to build text/coordinate indexes. Indexing runs locally and does not call a model.
3. Choose **与所选文献对话**, select a model already configured in DSH, and ask your question.
4. For evidence, ask the model to provide the paper, original quotation, physical page number and a verified citation. Click the citation to open **原文定位** in the right sidebar.

For example:

> Compare the evidence for this conclusion across the selected papers. Quote the relevant original sentences, give physical PDF page numbers, and verify each quotation before citing it.

The model must actually call the research tools. A text-only answer without a verified citation has not passed the quotation check.

### References and folder import

- **引用与导出** exports selected papers, or the current list when none are selected. Exporting or copying pins citation keys; later metadata enrichment will not silently change them. Edit keys under **编辑属性**.
- Auto-export tracks the whole library or a collection including its descendants. It writes to `exports/` inside the library. Stopping an auto-export retains the file.
- **导入文件夹** is a one-time recursive PDF import, not a watched-folder sync. Folder names become collections. Repeated content is reused and added to the appropriate collections. Source files are not moved.
- Supported limits are 50 MiB per PDF, 5,000 pages per indexed PDF and 10,000 PDFs per folder import. Non-PDF files are skipped.

## Storage and privacy

PDFs are **copied**, not linked. The library contains `library.sqlite`, `pdfs/`, notes/index data and optional `exports/` files. The initial default is `$DSH_HOME/literature-library`; a physical-profile pointer then keeps the chosen location stable across launches.

Change the directory in **数据源与存储 → 文库目录 → 迁移并切换**. Migration copies the data, checks PDF hashes and database integrity, then switches locations. The old directory is retained as a recovery copy. Back up the complete library, preferably after closing DSH.

| Operation | What leaves the machine |
| --- | --- |
| Import, indexing, quotation matching, page rendering, bibliography export | Nothing from these operations. |
| AI research | Metadata and passages returned by tools enter the context of the model/provider you selected in DSH. |
| Crossref/arXiv, when enabled | Titles and identifiers used for metadata lookup; no PDF binary/full-text upload. |
| easyScholar, when enabled | Journal name and your easyScholar key, sent to its HTTPS API. |

External metadata/rank services are disabled by default until enabled in settings. Store the easyScholar key through the settings form; the plugin uses DSH's credential store and does not echo the saved key to the client. No key is included in this repository.

The plugin adds an independent `literature` preset. Its six tools are unavailable to ordinary chats and check the session's selected-paper scope again at execution time. It does not replace your default model, global prompt, normal chat UI or other plugins' settings.

## Current scope

- Search is keyword based, not vector/semantic search.
- OCR, Word citation integration, CSL bibliography formatting, browser connectors and cloud sync are not implemented.
- The evidence reader renders the current PDF page with coordinate overlays; it does not alter the PDF. DSH's ordinary PDF preview remains available.
- Complex layouts may produce imperfect reading order. Check context when interpreting extracted text.
- This implements common citation-key/bibliography and folder-import workflows, not every feature of Better BibTeX or Zotero.
- Model access, subscription eligibility, quotas and provider availability are managed by DSH and the provider you choose.

## Development

```sh
python -m pip install -r requirements.txt
npm ci
npm run check
npm run check:package
```

`assets/client-features.js` and `assets/library.css` are inlined by `scripts/build.mjs` into the native ModuleLoader client. Runtime modules and this build source are committed. Tests use synthetic PDFs and mocked metadata services, not private papers, accounts or paid model requests. CI runs on Linux and Windows.

Before committing, run `npm run check:staged` after staging. It scans staged blobs rather than only the working files. `check:package` inspects the npm package allowlist and scans every packaged text file. Review changes manually as well: automated checks are a guard, not a substitute for reviewing sensitive material.

See [architecture](docs/architecture.md), [contributing](CONTRIBUTING.md), [publishing](docs/publishing.md) and [security](SECURITY.md).

## License and acknowledgements

Copyright © 2026 Lx23918 and contributors. Licensed under **AGPL-3.0-or-later**, without warranty. Commercial use is permitted under the license; no non-commercial restriction is added. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

PyMuPDF is installed separately and retains its upstream AGPL/commercial licensing terms. This repository and its package do not bundle PyMuPDF/MuPDF binaries. Upstream source/license references are provided in `NOTICE`.

Built using DSH's plugin and slot APIs. Workflow references: [Better BibTeX](https://retorque.re/zotero-better-bibtex/) and [Folder Import for Zotero](https://github.com/retorquere/zotero-folder-import). This project is independent of those projects and is not an official DeepSeek or Zotero plugin.
