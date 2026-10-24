# Publishing

1. Update the package version and changelog consistently.
2. Review the file allowlist. Do not copy a developer's entire DSH home, `STATE.md`, `runtime/`, `dev/`, `evidence/`, model/account data or private screenshots into a release tree.
3. Run `npm run check`, `npm run check:package`, stage only reviewed files and run `npm run check:staged`.
4. Inspect `git diff --cached --stat` and the actual staged diff. Review commit author metadata and remote URLs; use a public/noreply identity rather than a private email address.
5. Push source, wait for Linux and Windows CI, then create a matching version tag and GitHub Release. Publish the checked npm archive and its SHA-256 checksum. Link to the same tag's source archive.
6. Do not publish to npm or submit a marketplace entry as an accidental side effect of the build. Those are separate release actions.

The npm package ships only runtime modules/assets, the bundle patch, requirements, both READMEs, LICENSE and NOTICE. It does not bundle the Python interpreter, PyMuPDF/MuPDF binaries, host code, private diagnostics or development libraries.

For future marketplace submission, see the current [Awesome DSH contribution requirements](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md). The package must expose `dsh.bundle` and a real additive patch. Listing is not automatic; do not display a listing badge before acceptance.

Reference entry (prepare only; submit separately):

```yaml
url: https://github.com/Lx23918/dsh-literature
name: Lx23918/dsh-literature
category: docs
description:
  en: Native literature management with local PDF search, verified citations and bibliography export.
  zh: 在 DSH 中管理本地论文、检索原文、核验引用并导出参考文献。
```
