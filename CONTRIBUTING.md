# Contributing / 贡献指南

Use synthetic papers and placeholder credentials. Do not submit private library data, screenshots of real accounts, model session logs, local installation paths, or production API keys. See [SECURITY.md](SECURITY.md).

## Check a change

```sh
python -m pip install -r requirements.txt
npm ci
npm run check
npm run check:package
git add <reviewed-files>
npm run check:staged
```

The Python interpreter can be selected with `DSH_LITERATURE_PYTHON`. Functional tests do not contact model providers. Native host acceptance requires the supported DSH version; passing unit tests alone is not a native UI or real-provider acceptance claim.

Keep generated `lib/client.js` synchronized with `assets/client-features.js` and `assets/library.css` by running the build. Submit source and generated runtime together so a Git install has an executable client.

## Plugin boundaries

- Add services and slots; do not replace global prompts, models, ordinary chat or another plugin's registrations.
- Own resources through Cordis context effects. Check cold start, hot disable/enable and disposal for changes involving background work or registration.
- Keep model tools scoped to the literature preset and check paper/session membership on the host.
- Use host theme tokens and React slots. Keep UI content in owned components.
- Preserve migrations and library recovery copies. Test new tables and portable paths when storage changes.
- Never add networking, model calls or credential refresh to a unit test.

These practices follow the host's [plugin guidance](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/preset/agent-preset/skills/cordis-plugin-development). Confirm contracts against the installed host version before changing an API integration.

Contributions are accepted under AGPL-3.0-or-later. Preserve third-party notices; do not import code whose license is incompatible with the contribution.
