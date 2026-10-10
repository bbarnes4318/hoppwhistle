# Agent portal: screenshots

What a Life Leads Plus **agent** sees, before (`main` at 4426170) and after this
branch. The agent is Marcus Bell, a closing-tier A agent on the demo data, signed
in with a password, so every screen shows the calls and applications the demo
actually gave him (an agent's lists are narrowed server-side to their own).

- `before/` — `main`, the same demo data and the same clock.
- `after/` — this branch.

Each screen has three shots:

| File                 | What                                   |
| -------------------- | -------------------------------------- |
| `<id>-1366.png`      | 1366×768 viewport, as it first appears |
| `<id>-1366-full.png` | 1366 wide, the whole page              |
| `<id>-390.png`       | 390 wide (a phone), the whole page     |

| Screen               | Route              | What changed                                                                                                                                                |
| -------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-my-day`       | `/delivery/me`     | Hero tiles with a 7-day shape, the closing percentage against the agency, a secondary row and a "Your last 7 days" table                                    |
| `agent-power-dialer` | `/call-center`     | The row of figures is the server's, not browser tallies; the auto-dialer bar and the Application queue use the shared buttons, panel, table and empty state |
| `agent-applications` | `/applications`    | "Every application you submitted"; no Agent column repeating their own name                                                                                 |
| `agent-customers`    | `/insurance-leads` | No Agent column                                                                                                                                             |
| `agent-leaderboard`  | `/leaderboard`     | "Where you stand on the floor…" instead of "Your agents ranked…"                                                                                            |
| `agent-settings`     | `/settings`        | No Webhooks (an owner's plumbing); opens on DNC lists; no duplicated "Settings" heading                                                                     |
| `agent-calls`        | `/calls`           | Unchanged apart from quiet zeros in the live strip; it already hides Went to, Revenue and Payout from agents                                                |

The live strip across the top is the same on every screen, with its plain zeros
now quiet (ink-3) and its coloured conversion left as a warning.

## Reproducing

Both sets come from `apps/web/e2e/overhaul-screenshots.mjs` against a disposable
database (loopback, "test" in its name), after `prisma db push`:

```sh
# after
SHOTS_DATABASE_URL=postgresql://test:test@localhost:5432/hopwhistle_test \
SHOTS_REDIS_URL=redis://localhost:6379/4 \
SHOTS_CLOCK=14:30 SHOTS_LABEL=after \
SHOTS_OUT=docs/screenshots/agent SHOTS_ONLY='^agent-' \
node apps/web/e2e/overhaul-screenshots.mjs

# before: the same, against a worktree of main with this checkout's
# node_modules and build outputs linked in
SHOTS_APP_ROOT=../hw-main SHOTS_LABEL=before ... node apps/web/e2e/overhaul-screenshots.mjs
```

The demo data is relative to the day it is seeded, so the two sets must be shot on
the same New York day: shot on different days, their numbers differ.

`SHOTS_CLOCK=14:30` runs the seed, the API, `next dev` and the browser as of 2:30
PM in New York, so "today so far" reads as a working day whenever the shots are
taken. The "Reconnecting" pill at the bottom right is the harness having no
realtime socket; it is not part of the app's screens.
