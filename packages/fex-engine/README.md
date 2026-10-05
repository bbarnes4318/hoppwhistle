# @hopwhistle/fex-engine

The final expense quote engine: underwriting + pricing for every loaded carrier
product, with cited reasons. Pure TypeScript, no I/O.

- `src/engine.ts` — `quoteAll(bundle, applicant, options, drugs)` ranks every
  quotable product; `quoteProduct(...)` evaluates one.
- `src/drug-index.ts` — `DrugIndex`: drug name resolution, typeahead search,
  ingredient/class relationships, multi-use detection, indication options.
- `src/catalog.ts` — browser-safe UI data: answer buckets, knockout chips,
  condition synonyms, condition follow-up fields, status labels.
- `src/application-carriers.ts` — product → application-form carrier name and
  `planType`, and payments per year for annualising.
- `src/types.ts` — bundle, applicant and result types.

The carrier data is NOT in this package. It is
`apps/api/assets/fex/fex-bundle.v18.json` (2.8 MB: 35 products, 69 rate tables,
181 conditions, 1,017 drug ingredients, 6,628 Rx entries, 1,334 rules). The API
loads it once at startup and never sends rate tables or rule records to a
browser.

## Parity

The engine is a typed port of the minified engine inside
`FEX_Quote_Engine_v18.html`. `test/golden.v18.json` holds that original build's
answers for 4,000 generated applicants (every reason kind: application
questions, guide rules, Rx, build, combinations, state, routing, age). The port
reproduces all 4,000 byte-for-byte, and also matched a further 20,000 during
the port. `pnpm --filter @hopwhistle/fex-engine test` runs the check.

Do not regenerate `golden.v18.json` from this code to make a failing test pass.
A failure means the port changed behaviour.

## Data updates

A new carrier data build ships as a new file (`fex-bundle.v19.json`) beside the
old one, with its own golden file made from a reviewed run. Bump
`FEX_BUNDLE_FILE` in `apps/api/src/services/fex/bundle.ts`.
