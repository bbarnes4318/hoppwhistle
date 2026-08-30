'use client';

import { Menu } from 'lucide-react';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { SheetDrawer } from '@/components/domain';

import { Sidebar } from './sidebar';

/**
 * The navigation, below the breakpoint where the rail fits.
 *
 * The rail is a fixed 208px column, which on a 375px phone leaves 167px for the
 * page — not enough for a call list, or for anything else. Below `md` the rail
 * is hidden and the same nav opens from the left in the standard drawer, so
 * there is one navigation to maintain rather than two.
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="-ml-1 rounded-control p-1.5 text-ink-3 hover:bg-sunken hover:text-ink focus-visible:outline-none md:hidden"
      >
        <Menu aria-hidden className="h-4 w-4" />
      </button>

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
