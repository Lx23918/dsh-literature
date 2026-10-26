# Architecture

```mermaid
flowchart LR
    PDF[User-selected local PDFs] --> Store[Managed library + SQLite]
    Store --> Index[Text + word coordinates + FTS5]
    Session[Native DSH research session] --> Tools[Scoped literature tools]
    Tools --> Index
    Tools --> Verify[Quote match + PDF fingerprint]
    Verify --> Reader[Native right-sidebar evidence reader]
    Store --> Bib[BibTeX / BibLaTeX / CSL exports]
```

## Host and client

`cordis.patch.yml` adds a library service and a separate `literature` preset. `lib/index.js` exposes the plugin's own typed RPC dispatcher; `lib/research.js` registers tools only in that preset. Ordinary chat does not acquire those tools or their prompt.

`lib/preset.js` reads the ordinary default preset through the host registry's composition document API, decodes it with the host's entry-list schema, and registers the complete composition plus the literature tools. This retains nested groups, native tool configuration and deferred expressions; it does not maintain a reduced tool list or alter the source preset. `basePreset` can select another native preset. The inherited definition refreshes when this plugin loads, so restart after changing the base configuration. File, shell and network operations retain the native implementation and policies.

`lib/client.js` is a native DSH ModuleLoader bundle using React slots and host theme tokens. It uses DSH's existing sessions, model picker and streaming renderer. The evidence reader is a separate right-sidebar tab; default PDF preview remains available. API changes in other host versions require a compatibility review.

## Evidence

`pdf_extract.py` extracts words with UTF-16 text offsets and normalized display coordinates, including page rotation. `pages` stores the text, `pages_fts` its keyword index, and `page_geometry` the coordinates. `pdf_indexes` records the content fingerprint and extraction version.

`literature_verify_quote` checks session membership, normalizes typographic whitespace/compatibility glyphs and matches source text. It rejects unknown quotes and disambiguates repeated occurrences. A persistent citation stores the quote, source offsets, boxes and PDF hash.

Native chat Markdown accepts full local HTTP links; the client intercepts the plugin's citation marker and resolves the opaque citation ID locally. Historical loopback ports are supported. The host checks scope and content hash again before rendering. Current-page images are generated on demand and are not stored as an image cache.

## Storage and credentials

Each library has its own SQLite database and managed PDF directory. The physical profile stores a separate location pointer. Migration snapshots SQLite, copies/checks PDFs, rewrites managed attachment paths and switches the pointer only after validation. Old data stays available for recovery. Citation records and auto-export configuration move with it.

Optional journal credentials are saved through DSH's credential service. They do not belong in library records, repository files or diagnostic output. Metadata providers receive only the documented lookup fields. Model providers receive the tool output requested in the selected-paper session.

All asynchronous work and registrations have an unload path. Indexing/rendering subprocesses are stopped before database closure; automatic bibliography writes finish before disposal.

## Bounded research

`retrieval.js` supplies compact model-facing catalog pages, a separately persisted task focus, bounded text windows, ranked keyword snippets, batch quote verification and reuse of fingerprint-validated citations. Existing library UI search and full store read contracts remain available. `research_tasks` references the session binding with cascading deletion and is included in migration checks.

`manuscript.js` reads text through the host filesystem seam, expands bounded in-project LaTeX includes without executing TeX, selects a section and maps cited keys conservatively against allowed papers. DOI conflicts and ambiguous titles are surfaced. `vision.js` requires the active model to declare image input and sends rendered PDF pages through the native attachment store, with image blocks rather than Base64 text. These controls reduce tool output; they do not estimate subscription-quota savings or modify the host model configuration.
