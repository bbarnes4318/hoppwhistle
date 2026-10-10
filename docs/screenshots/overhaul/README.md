# Portal visual overhaul: screenshots

Every screen of the white-label owner portal (Life Leads Plus theme), the
platform-admin preview "As agency owner", a downline owner, and the buyer and
publisher portals, before (`main` at 16e61eb) and after this branch.

- `before/` — `main`, the same demo data and the same clock.
- `after/` — this branch.

Each screen has three shots:

| File                 | What                                   |
| -------------------- | -------------------------------------- |
| `<id>-1366.png`      | 1366×768 viewport, as it first appears |
| `<id>-1366-full.png` | 1366 wide, the whole page              |
| `<id>-390.png`       | 390 wide (a phone), the whole page     |

Screens of note: `today`, `today-yesterday`, `today-last-7-days` (the three
periods), `today-zero` (today with its calls removed: the zero-calls layout),
`calls-filtered` (two filters active, as chips), `preview-*` (a platform admin
previewing the agency as its owner) and `downline-*`.

## Reproducing

Both sets come from `apps/web/e2e/overhaul-screenshots.mjs` against a
disposable database (loopback, "test" in its name), after
`prisma db push`:

```sh
# after
SHOTS_DATABASE_URL=postgresql://test:test@localhost:5432/hopwhistle_test \
SHOTS_REDIS_URL=redis://localhost:6379/4 \
SHOTS_CLOCK=14:30 SHOTS_LABEL=after \
node apps/web/e2e/overhaul-screenshots.mjs

# before: the same, against a worktree of main with this checkout's
# node_modules linked in
SHOTS_APP_ROOT=../hw-main SHOTS_LABEL=before ... node apps/web/e2e/overhaul-screenshots.mjs
```

It reseeds `scripts/seed/life-leads-plus-demo.sql` first, signs in as a real
Life Leads Plus OWNER + ADMIN (and the other people above), and fails if any
API request a screen makes is refused. `SHOTS_CLOCK=14:30` runs the seed, the
API, `next dev` and the browser as of 2:30 PM in New York today, so Today shows
a working day whenever the shots are taken.
