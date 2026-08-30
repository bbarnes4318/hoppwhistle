import * as React from 'react';

import { DurationBar } from '@/components/domain/duration-bar';
import { ThemeScope } from '@/components/domain/theme-scope';
import { cn } from '@/lib/utils';

import {
  DERIVED_TOKENS,
  DURATION_CASES,
  INK_TOKENS,
  RULE_TOKENS,
  SIGNAL_TOKENS,
  SURFACE_TOKENS,
  TYPE_STEPS,
  type TokenRow,
} from './tokens';

type Theme = 'light' | 'dark';

/* -------------------------------------------------------------------------- */

function SectionHeading({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-3">
      <h3 className="t-label text-ink-3">{children}</h3>
      {sub ? <p className="t-meta mt-1 text-ink-3">{sub}</p> : null}
    </div>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={cn('rounded-card border border-rule bg-surface p-4', className)}
      // Flat surfaces separated by a hairline, never a shadow.
    >
      {children}
    </section>
  );
}

/* ---------------------------------- colour --------------------------------- */

function SwatchRow({ token, theme }: { token: TokenRow; theme: Theme }) {
  const hex = theme === 'light' ? token.light : token.dark;
  const ratio = token.onPaper?.[theme];
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div
        className="h-8 w-8 shrink-0 rounded-control border border-rule"
        style={{ backgroundColor: `var(${token.name})` }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <code className="t-data text-ink">{token.name}</code>
          <code className="t-data text-ink-3">{hex}</code>
          {ratio !== undefined && (
            <span
              className={cn('t-meta tabular', ratio >= 4.5 ? 'text-ink-3' : 'text-ringing-ink')}
              title={
                ratio >= 4.5
                  ? 'Clears WCAG AA for normal text on --paper'
                  : 'Below 4.5:1 on --paper — not for small body text'
              }
            >
              {ratio.toFixed(2)}:1
            </span>
          )}
        </div>
        <div className="t-meta text-ink-3">{token.role}</div>
      </div>
    </div>
  );
}

function ColourGroup({
  title,
  sub,
  tokens,
  theme,
}: {
  title: string;
  sub?: string;
  tokens: TokenRow[];
  theme: Theme;
}) {
  return (
    <div>
      <SectionHeading sub={sub}>{title}</SectionHeading>
      <div className="divide-y divide-rule">
        {tokens.map(t => (
          <SwatchRow key={t.name} token={t} theme={theme} />
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------- type ---------------------------------- */

function TypeScale() {
  return (
    <div className="space-y-5">
      {TYPE_STEPS.map(step => (
        <div key={step.cls} className="border-b border-rule pb-5 last:border-0 last:pb-0">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
            <code className="t-data text-ink">{step.name}</code>
            <span className="t-meta text-ink-3">{step.spec}</span>
            <span className="t-meta text-ink-3">· {step.usage}</span>
          </div>
          <div className={cn(step.cls, 'text-ink')}>{step.sample}</div>
        </div>
      ))}

      {/*
        The reason IBM Plex Mono is here at all: a column of money and duration
        has to align or it cannot be scanned. Proportional figures do not.
      */}
      <div className="rounded-control bg-sunken p-3">
        <div className="t-label mb-2 text-ink-3">Tabular figures, why the mono face exists</div>
        <table className="w-full">
          <thead>
            <tr className="text-left">
              <th className="t-label pb-1 font-medium text-ink-3">Call</th>
              <th className="t-label pb-1 text-right font-medium text-ink-3">Duration</th>
              <th className="t-label pb-1 text-right font-medium text-ink-3">Payout</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['cal_9f3b2e71', '2:47', '$18.40'],
              ['cal_1a08c4d2', '11:03', '$4.05'],
              ['cal_77be0915', '0:58', '$110.00'],
              ['cal_c3d5f118', '1:11:09', '$9.75'],
            ].map(([id, dur, amt]) => (
              <tr key={id}>
                <td className="t-data py-0.5 text-ink-2">{id}</td>
                <td className="t-data py-0.5 text-right text-ink">{dur}</td>
                <td className="t-data py-0.5 text-right text-ink">{amt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------- duration bar ------------------------------ */

/**
 * A shared scale across all eight cases, which is how the component is meant to
 * be used in a table. Comparing bars only means something when the seconds-per-
 * pixel is the same for every row.
 */
const SHARED_SCALE = 180;

function DurationStates() {
  return (
    <div className="space-y-4">
      <p className="t-body text-ink-2">
        All eight bars share one 180-second scale, the way rows of a table must. The tick is the
        billable threshold at 60s.
      </p>
      <div className="divide-y divide-rule">
        {DURATION_CASES.map(c => (
          <div key={c.title} className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-[200px_1fr]">
            <div className="min-w-0">
              <div className="t-body font-medium text-ink">{c.title}</div>
              <div className="t-meta text-ink-3">{c.note}</div>
            </div>
            <div className="flex min-w-0 items-center">
              <DurationBar
                seconds={c.seconds}
                thresholdSeconds={c.threshold}
                scaleSeconds={SHARED_SCALE}
                inProgress={'inProgress' in c ? c.inProgress : false}
                showValue
                className="w-full"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-control bg-sunken p-3">
        <div className="t-label mb-2 text-ink-3">Detail size, for the recording player</div>
        <DurationBar
          seconds={72}
          thresholdSeconds={60}
          scaleSeconds={SHARED_SCALE}
          size="detail"
          showValue
        />
      </div>

      <div className="rounded-control bg-sunken p-3">
        <div className="t-label mb-2 text-ink-3">In a table row, 40px, at a shared scale</div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-rule text-left">
              <th className="t-label py-1 font-medium text-ink-3">From</th>
              <th className="t-label py-1 font-medium text-ink-3">Length</th>
              <th className="t-label py-1 text-right font-medium text-ink-3">Payout</th>
            </tr>
          </thead>
          <tbody>
            {[
              { from: '+1 (415) 555-0142', s: 96, t: 60, pay: '$18.40' },
              { from: '+1 (312) 555-8827', s: 41, t: 60, pay: '—' },
              { from: '+1 (786) 555-3390', s: 152, t: 60, pay: '$22.15' },
              { from: '+1 (602) 555-1174', s: 12, t: 60, pay: '—' },
            ].map(r => (
              <tr key={r.from} className="h-row border-b border-rule last:border-0">
                <td className="t-data pr-3 text-ink">{r.from}</td>
                <td className="w-[45%] py-0 pr-3">
                  <DurationBar
                    seconds={r.s}
                    thresholdSeconds={r.t}
                    scaleSeconds={SHARED_SCALE}
                    showValue
                  />
                </td>
                <td
                  className={cn(
                    't-data text-right',
                    r.pay === '—' ? 'text-ink-3' : 'text-money-ink'
                  )}
                >
                  {r.pay}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* --------------------------------- the pane -------------------------------- */

/**
 * One complete rendering of the system in a single theme. Rendered twice, side
 * by side, with nothing but the `data-theme` attribute differing — which is the
 * point: if the two panes diverge in anything but colour, a token is missing.
 */
export function ThemePane({ theme }: { theme: Theme }) {
  return (
    <ThemeScope theme={theme} className="rounded-card border border-rule bg-paper">
      <header className="flex items-baseline justify-between border-b border-rule px-4 py-3">
        <h2 className="t-title text-ink">{theme === 'light' ? 'Light' : 'Dark'}</h2>
        <code className="t-meta text-ink-3">
          {theme === 'light' ? ':root' : "[data-theme='dark']"}
        </code>
      </header>

      <div className="space-y-6 p-4">
        <Panel>
          <ColourGroup title="Surfaces" tokens={SURFACE_TOKENS} theme={theme} />
        </Panel>

        <Panel>
          <ColourGroup
            title="Ink"
            sub="Ratio is against --paper in this theme. AA for normal text is 4.5:1."
            tokens={INK_TOKENS}
            theme={theme}
          />
        </Panel>

        <Panel>
          <ColourGroup title="Rules" tokens={RULE_TOKENS} theme={theme} />
        </Panel>

        <Panel>
          <ColourGroup
            title="Signals"
            sub="Call states, not generic UI semantics. Blocked is violet because a compliance stop is the system working."
            tokens={SIGNAL_TOKENS}
            theme={theme}
          />
        </Panel>

        <Panel>
          <ColourGroup
            title="Derived"
            sub="Not in the brief. Added because chips, text-on-tint and DurationBar overage need them."
            tokens={DERIVED_TOKENS}
            theme={theme}
          />
        </Panel>

        <Panel>
          <SectionHeading sub="Signal on its own tint — the StatusChip treatment for prompt 2.">
            Signals in use
          </SectionHeading>
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'Connected', tint: 'bg-live-tint', ink: 'text-live-ink' },
              { label: 'Ringing', tint: 'bg-ringing-tint', ink: 'text-ringing-ink' },
              { label: 'Abandoned', tint: 'bg-dropped-tint', ink: 'text-dropped-ink' },
              { label: 'DNC block', tint: 'bg-blocked-tint', ink: 'text-blocked-ink' },
              { label: 'Paid $18.40', tint: 'bg-money-tint', ink: 'text-money-ink' },
            ].map(c => (
              <span
                key={c.label}
                className={cn('t-meta rounded-control px-2 py-1 font-medium', c.tint, c.ink)}
              >
                {c.label}
              </span>
            ))}
          </div>
        </Panel>

        <Panel>
          <SectionHeading>Type scale</SectionHeading>
          <TypeScale />
        </Panel>

        <Panel>
          <SectionHeading sub="Signature 1. Everything else is built on top of this.">
            DurationBar
          </SectionHeading>
          <DurationStates />
        </Panel>
      </div>
    </ThemeScope>
  );
}
