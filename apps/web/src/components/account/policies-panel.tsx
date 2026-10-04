import { ArrowUpRight, Database, FileText, Mic, Scale, Shield } from 'lucide-react';

import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle } from '@/components/domain';
import { cn } from '@/lib/utils';

/**
 * The policies that govern every account, linked from Account.
 *
 * They are here as well as under Settings because an agent no longer has
 * Settings in their sidebar -- for them it was the agency's DNC
 * administration -- and the policies that govern their account are theirs to
 * read. They are public pages; nothing here is the agency's.
 */
const DOCUMENTS = [
  {
    href: '/legal/privacy',
    name: 'Privacy Policy',
    detail: 'What we collect, why, and who it is shared with.',
    icon: Shield,
  },
  {
    href: '/legal/terms',
    name: 'Terms of Service',
    detail: 'The agreement that covers your use of the platform.',
    icon: Scale,
  },
  {
    href: '/legal/data-retention',
    name: 'Data Retention Policy',
    detail: 'How long calls, leads and records are kept.',
    icon: Database,
  },
  {
    href: '/legal/call-recording',
    name: 'Call Recording Policy',
    detail: 'When calls are recorded and how consent is handled.',
    icon: Mic,
  },
] as const;

export function PoliciesPanel(): JSX.Element {
  return (
    <Panel data-legal-documents>
      <PanelHeader>
        <PanelTitle className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-ink-3" aria-hidden />
          Policies
        </PanelTitle>
        <PanelDescription>Privacy, terms, data retention and call recording</PanelDescription>
      </PanelHeader>
      <PanelBody flush>
        <ul className="grid divide-y divide-rule sm:grid-cols-2 sm:divide-y-0">
          {DOCUMENTS.map((doc, index) => (
            <li
              key={doc.href}
              className={cn(
                'sm:border-rule',
                index % 2 === 0 ? 'sm:border-r' : null,
                index < 2 ? 'sm:border-b' : null
              )}
            >
              <a
                href={doc.href}
                className={cn(
                  'group flex min-h-[44px] min-w-0 items-start gap-3 px-5 py-4 min-[1440px]:px-6',
                  'transition-colors duration-150 ease-out hover:bg-paper',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-brand-tint text-brand-ink">
                  <doc.icon aria-hidden className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{doc.name}</span>
                  <span className="t-meta block text-ink-3">{doc.detail}</span>
                </span>
                <ArrowUpRight
                  aria-hidden
                  className="mt-0.5 h-4 w-4 shrink-0 text-ink-3 transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink"
                />
              </a>
            </li>
          ))}
        </ul>
      </PanelBody>
    </Panel>
  );
}
