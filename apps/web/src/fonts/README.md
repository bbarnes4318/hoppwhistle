# Fonts

Committed rather than fetched at build time. `next/font/google` downloads from
`fonts.googleapis.com` during `next build`, and `apps/web/Dockerfile` runs that
build inside the image — so a Google outage or a locked-down build network would
fail the deploy, not just degrade it. CI was already observed failing the first
fetch attempt for all three families at once; it only recovered on retry.

| File                                 | Family              | Weight  | Kind     | Size  |
| ------------------------------------ | ------------------- | ------- | -------- | ----- |
| `BricolageGrotesque-500-latin.woff2` | Bricolage Grotesque | 500     | static   | 22 KB |
| `Inter-Variable-latin.woff2`         | Inter               | 100–900 | variable | 48 KB |
| `IBMPlexMono-400-latin.woff2`        | IBM Plex Mono       | 400     | static   | 15 KB |
| `IBMPlexMono-500-latin.woff2`        | IBM Plex Mono       | 500     | static   | 15 KB |

100 KB total. WOFF2 only, latin subset only — Google Fonts' own subset files,
unmodified. Coverage matches the `subsets: ['latin']` this app already shipped,
so this is a change of transport, not of coverage.

**Bricolage is a static instance on purpose.** It carries three axes (opsz, wdth,
wght) and the variable latin subset is 77 KB against 22 KB for the single
instance — identical output, since the type scale only ever sets weight 500. Add
another static instance if a second weight is needed; do not swap back to the
variable file for one more weight.

**Inter stays variable** because the UI genuinely uses a spread of weights (400
body, 500 labels and section heads), and one variable file beats two statics.

## Adding coverage

Latin Extended cannot simply be dropped in as another `src` entry:
`next/font/local` entries take only `path`, `weight` and `style`, with no
per-file `unicode-range`, so a second file at the same weight would never be
selected. It needs a merged subset file or hand-written `@font-face` rules with
explicit `unicode-range`.

## Licences

All three are SIL Open Font License 1.1, which permits redistribution in this
form. Each family's licence is committed beside its files:

| Family              | Licence                      | Upstream                                  |
| ------------------- | ---------------------------- | ----------------------------------------- |
| Bricolage Grotesque | `OFL-BricolageGrotesque.txt` | https://github.com/ateliertriay/bricolage |
| Inter               | `OFL-Inter.txt`              | https://github.com/rsms/inter             |
| IBM Plex Mono       | `OFL-IBMPlexMono.txt`        | https://github.com/IBM/plex               |

## Updating

Refetch from the Google Fonts CSS API with a modern User-Agent — an old one
returns TTF instead of WOFF2 — taking the `latin` block only. Request a single
weight (`:wght@500`) to get a static instance; a range returns the variable file.
Then check `/design-preview` renders in the real face, not the fallback.
