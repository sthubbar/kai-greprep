# kai-greprep

Adaptive practice app for the GRE Mathematics Subject Test. Live at https://kai-greprep.netlify.app

This repo is the source of truth for the deploy. Pushing to `main` triggers a Netlify build and publish. CI runs in GitHub Actions and blocks the deploy if the question bank fails validation.

## Contents

- `index.html` single-file frontend (KaTeX, Chart.js lazy-loaded, vanilla JS).
- `questions.json` the 330-question bank, 5 ETS forms.
- `images/` cropped figures referenced by some questions.
- `netlify/functions/` four serverless proxies: `tutor.js`, `generate.js`, `pattern.js`, `health.js`.
- `netlify.toml` build config.
- `package.json` Node 18+, no npm dependencies.
- `scripts/validate_bank.py` the bank validator. CI runs this on every push and PR.
- `.github/workflows/test.yml` the CI definition.

## Required environment variables (set in Netlify project)

- `ANTHROPIC_API_KEY` Anthropic API key. Required.
- `ACCESS_PASSWORD` shared password gating the AI features. Required.
- `GRE_TUTOR_MODEL` optional, defaults to `claude-opus-4-7`. Fall back to `claude-sonnet-4-6` if unset.

These live ONLY in the Netlify dashboard. Never commit them.

## Contributing

1. Branch from `main`.
2. Edit files.
3. Push and open a PR.
4. CI runs `validate_bank.py`, parses every function with `node --check`, and checks `index.html` ends with `</html>`.
5. Once tests pass, merge to `main`. Netlify auto-publishes within 10 seconds.

## Validating locally

```
python3 scripts/validate_bank.py
```

Returns nonzero if any question fails schema, has a non-canonical topic tag, references a missing image, or contains an em or en dash. CI fails the build on the same conditions.

## Rolling back

In the Netlify Deploys page, find the prior deploy and click "Publish deploy." Live within seconds.

## Style rules that the validator enforces

- No em dash (U+2014) or en dash (U+2013) in stems, options, or explanations.
- Answer index is an integer 0..4.
- Topic tags must be in the canonical taxonomy listed in `scripts/validate_bank.py`.
- Every referenced image must exist on disk.
- Status must be `active`, `deferred`, or `retired`.
- Difficulty must be `easy`, `medium`, or `hard`.

## Operational rules

Never commit API keys. They live in Netlify env vars.

Never edit `questions.json` directly without running the validator first. The CI is your second line of defense; the validator on your machine is the first.

If the bank changes, the Question Bank/questions.json file in the parent folder must be kept in sync. The validator does not enforce that across-repo invariant; the daily ingestion task does.

Tag every material change in coordination files with `(Steve, YYYY-MM-DD)` or `(Claude inference, YYYY-MM-DD)`.

## Phase notes

This is Phase 2 of the app. Phase 1 lives in `../_legacy/netlify_deploy/`. Phase 1 features were a smaller bank and single-shot tutor. Phase 2 added multi-user profiles, multi-turn chat, generate-similar, the heatmap, pattern detection, topic filter, custom session mode, bookmarks, notes, score chart, target-date dashboard.
