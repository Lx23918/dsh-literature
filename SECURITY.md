# Security and private data

Report vulnerabilities privately through this repository's **Security → Report a vulnerability** page when available. Do not disclose credentials or private documents in a public issue. If private reporting is unavailable, open a minimal issue requesting a private reporting channel without including exploit details or sensitive data.

Never attach a DSH home directory, credential store, OAuth session, `.env`, API key, proxy configuration, library database, private PDF or unredacted session log to an issue or pull request. Reproduce with a synthetic document instead. Redact personal paths and identifying screenshots.

The current release is tested against DSH 0.2.1-rc.2. Use a local profile with only the permissions and data you intend to expose to its plugins. Research tools check selected-paper scope, but the plugin itself executes with host filesystem access to manage the configured library.

Local import/indexing does not send papers to an external service. AI tool results do enter the context of the provider chosen in DSH. Optional Crossref/arXiv/easyScholar calls and their payloads are documented in README.md.

Release review includes a clean source allowlist, staged-blob scanning and package-content scanning. These checks report rule names and file paths, never matched credential values. Maintainers must still inspect the diff and any approved visual assets before publication.
