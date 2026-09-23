'use client';

import { Menu } from 'lucide-react';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { SheetDrawer } from '@/components/domain';
import { Tooltip } from '@/components/ui/tooltip';

import { Sidebar } from './sidebar';

/**
 * The navigation, below the breakpoint where the rail fits.
 *
 * The rail is a fixed 248px column, which on a 390px phone leaves 142px for the
 * page — not enough for a call list, or for anything else. Below `md` the rail
 * is hidden and the same nav opens from the left in the standard drawer, so
 * there is one navigation to maintain rather than two — and one active-item
 * rule: the drawer renders the same <Sidebar>, which highlights exactly one
 * item, the longest href that matches the page.
 */
export function MobileNav() {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  // Following a link must close the panel it was followed from.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <Tooltip content="Open navigation" className="-ml-2 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          className="flex h-10 w-10 items-center justify-center rounded-control text-ink-2 [&_svg]:h-5 [&_svg]:w-5 transition-colors duration-150 hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Menu aria-hidden className="h-4 w-4" />
        </button>
      </Tooltip>

      <SheetDrawer
        open={open}
        onOpenChange={setOpen}
        side="left"
        size="md"
        title="Navigation"
        className="sm:max-w-[16rem]"
      >
        <Sidebar variant="drawer" />
      </SheetDrawer>
    </>
  );
}
