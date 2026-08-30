'use client';

import { AlertTriangle, ShieldOff } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * ComplianceOverrideBanner — persistent, undismissable, for as long as any
 * compliance gate is switched off.
 *
 * An override is not a blocked call, which is why it is not violet. Violet says
 * "the system stopped this on purpose". An override is the inverse: the check is
 * off and calls are flowing without it. Nothing is blocked — the protection is.
 *
 * The real failure mode is not the override itself, it is the one somebody set
 * during an outage and forgot. So:
 *
 *   - an override with a future expiry is AMBER — deliberate, bounded, visible;
 *   - an override with NO expiry is RED, because nothing will ever turn it back
 *     on except a person remembering;
 *   - an override already past its expiry but still active is RED, because the
 *     thing that was supposed to clean it up did not.
 *
 * It cannot be dismissed. Being uncomfortable to look at is the feature — the
 * cost of leaving a gate open should be paid continuously, by everyone, rather
 * than once by whoever opened it.
 */

export interface ComplianceOverride {
  id: string;
  /** The gate being bypassed: "DNC check", "Litigator scrub", "Duplicate window". */
  gate: string;
  /** What it applies to: "Campaign: ACA Tier-1", "Publisher: Northstar". */
  scope?: string;
  /** When it lapses. `null` means it never does — the dangerous case. */
  expiresAt: Date | null;
  /** Who switched it off. Accountability belongs on the banner. */
  createdBy?: string;
}

export interface ComplianceOverrideBannerProps {
  overrides: ComplianceOverride[];
  /** Link to where these are managed. */
  href?: string;
  onReview?: (id: string) => void;
  className?: string;
}

/**
 * `unbounded` — no expiry at all, nothing will ever turn the gate back on.
 * `overdue`   — an expiry that has passed while the override is still active,
 *               so whatever was meant to clear it did not run.
 * `expiring`  — bounded and still in its window.
 *
 * The first two are both red, but they are different problems and the banner
 * must not describe one as the other: "no expiry" sends someone looking for a
 * missing setting when the real fault is a cleanup that failed.
 */
type Severity = 'expiring' | 'overdue' | 'unbounded';

function severityOf(o: ComplianceOverride, now: number): Severity {
  if (o.expiresAt === null) return 'unbounded';
  return o.expiresAt.getTime() <= now ? 'overdue' : 'expiring';
}

/** Names the worst thing that is true, and only if it is true. */
function headline(count: number, severities: Severity[]): string {
  const unbounded = severities.filter(s => s === 'unbounded').length;
  const overdue = severities.filter(s => s === 'overdue').length;
  const subject =
    count === 1
      ? 'A compliance gate is switched off'
      : `${count} compliance gates are switched off`;

  if (count === 1) {
    if (unbounded) return `${subject} with no expiry`;
    if (overdue) return `${subject} and is past its expiry`;
    return subject;
  }

  const clauses: string[] = [];
  if (unbounded) clauses.push(`${unbounded} with no expiry`);
  if (overdue) clauses.push(`${overdue} past expiry`);
  return clauses.length ? `${subject} — ${clauses.join(', ')}` : subject;
}

/** "in 2h 14m", "in 9m". Only rendered after mount — see the note below. */
function untilLabel(expiresAt: Date, now: number): string {
  const ms = expiresAt.getTime() - now;
  if (ms <= 0) return 'overdue';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return rem ? `in ${hours}h ${rem}m` : `in ${hours}h`;
  return `in ${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function absoluteLabel(d: Date): string {
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ComplianceOverrideBanner({
  overrides,
  href,
  onReview,
  className,
}: ComplianceOverrideBannerProps) {
  /*
   * `now` starts null and is only set after mount. Relative time computed during
   * render would differ between server and client and blow up hydration, so the
   * first paint shows the absolute expiry — which is stable — and the countdown
   * appears once mounted, refreshing every 30s.
   */
  const [now, setNow] = React.useState<number | null>(null);

  React.useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (overrides.length === 0) return null;

  // Severity is evaluated against mount time once known; before that, only a
  // null expiry can be judged, which is the case that matters most anyway.
  const reference = now ?? 0;
  const severities = overrides.map(o => severityOf(o, reference));
  const critical = severities.some(x => x === 'unbounded' || x === 'overdue');

  const tone = critical
    ? {
        bar: 'bg-dropped-tint border-dropped',
        icon: 'text-dropped',
        text: 'text-dropped-ink',
        strong: 'text-dropped-ink',
      }
    : {
        bar: 'bg-ringing-tint border-ringing',
        icon: 'text-ringing',
        text: 'text-ringing-ink',
        strong: 'text-ringing-ink',
      };

  const Icon = critical ? AlertTriangle : ShieldOff;

  return (
    <div
      // assertive, not polite: a gate coming off is worth interrupting for.
      role="alert"
      className={cn('border-b-2 px-3 py-2', tone.bar, className)}
    >
      <div className="flex items-start gap-2">
        <Icon aria-hidden className={cn('mt-0.5 h-4 w-4 shrink-0', tone.icon)} />

        <div className="min-w-0 flex-1">
          <p className={cn('t-body font-medium', tone.strong)}>
            {headline(overrides.length, severities)}
          </p>

          <ul className="mt-1 space-y-0.5">
            {overrides.map((o, i) => {
              const sev = severities[i];
              return (
                <li key={o.id} className={cn('t-meta flex flex-wrap items-baseline gap-x-1.5')}>
                  <span className={cn('font-medium', tone.text)}>{o.gate}</span>
                  <span className="text-ink-3">bypassed</span>
                  {o.scope ? <span className={tone.text}>· {o.scope}</span> : null}

                  {o.expiresAt === null ? (
                    <span className="t-data font-medium text-dropped-ink">· never expires</span>
                  ) : (
                    <span
                      className={cn(
                        't-data',
                        sev === 'unbounded' ? 'text-dropped-ink' : 'text-ink-2'
                      )}
                    >
                      · {sev === 'unbounded' ? 'expired' : 'expires'} {absoluteLabel(o.expiresAt)}
                      {now !== null ? (
                        <span className="text-ink-3"> ({untilLabel(o.expiresAt, now)})</span>
                      ) : null}
                    </span>
                  )}

                  {o.createdBy ? <span className="text-ink-3">· by {o.createdBy}</span> : null}

                  {onReview ? (
                    <button
                      type="button"
                      onClick={() => onReview(o.id)}
                      className={cn(
                        't-meta rounded-control px-1 underline underline-offset-2',
                        tone.text,
                        'hover:bg-surface/60 focus-visible:outline-none'
                      )}
                    >
                      Review
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>

        {href ? (
          <a
            href={href}
            className={cn(
              't-meta shrink-0 rounded-control px-2 py-1 font-medium underline underline-offset-2',
              tone.text,
              'hover:bg-surface/60 focus-visible:outline-none'
            )}
          >
            Manage overrides
          </a>
        ) : null}
      </div>
    </div>
  );
}
