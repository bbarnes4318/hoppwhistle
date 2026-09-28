import * as React from 'react';

import { PageHeader as SharedPageHeader } from '@/components/layout/page-header';

/**
 * One header for all six buyer pages: the shared page header, so the buyer
 * portal opens every screen the way the agency portal does -- title, the
 * page's job in one sentence under it, and the action at the right.
 *
 * The purpose line is the page's job in a sentence: the thing the buyer came
 * here to find out. The title is the page's nav name, and the topbar leaves
 * its own copy out while this is on screen, so the name is never shown twice.
 */
export function PageHeader({ purpose, action }: { purpose: string; action?: React.ReactNode }) {
  return <SharedPageHeader description={purpose} actions={action} />;
}
