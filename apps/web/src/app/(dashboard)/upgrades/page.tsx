'use client';

import Link from 'next/link';

import { Panel, PanelBody, StatusChip } from '@/components/domain';
import { WHITE_LABEL_UPGRADES } from '@/components/layout/nav-config';
import { PageHeader } from '@/components/layout/page-header';
import { useAuth } from '@/hooks/use-auth';

/**
 * Upgrades: what a white-label agency can have turned on.
 *
 * These five used to sit at the foot of the sidebar as locked entries. They
 * are one page now, with the same blurbs. Nothing here turns anything on --
 * the agency's account manager does -- so each card says who to ask, and one
 * that is already on says so. Which are on comes from the session
 * (`/api/auth/me` `upgrades`).
 */
export default function UpgradesPage(): JSX.Element {
  const { upgrades } = useAuth();

  return (
    <div className="page-canvas">
      <PageHeader description="Features you can add. Your account manager turns them on." />
      <section
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        aria-label="Upgrades"
      >
        {WHITE_LABEL_UPGRADES.map(({ key, item, note }) => {
          const Icon = item.icon;
          const on = upgrades.includes(key);
          return (
            <Panel key={key} data-upgrade={key}>
              <PanelBody className="flex h-full flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-brand-tint text-brand-ink">
                    <Icon className="h-4 w-4" />
                  </span>
                  {on ? <StatusChip value="ACTIVE" label="On" tone="live" size="sm" /> : null}
                </div>
                <h2 className="t-title text-ink">{item.name}</h2>
                <p className="t-body text-ink-2">{item.locked?.blurb}</p>
                {note ? <p className="t-body text-ink-2">{note}</p> : null}
                <p className="mt-auto t-meta text-ink-3">
                  {on ? 'Turned on for your agency.' : 'Ask your account manager to turn this on.'}
                </p>
                {on && key === 'POWER_DIALER' ? (
                  <div className="flex flex-wrap gap-3 t-meta">
                    <Link href="/call-center" className="text-brand-ink hover:underline">
                      Open the Power Dialer
                    </Link>
                    <Link href="/insurance-leads" className="text-brand-ink hover:underline">
                      Open the CRM
                    </Link>
                  </div>
                ) : null}
              </PanelBody>
            </Panel>
          );
        })}
      </section>
    </div>
  );
}
