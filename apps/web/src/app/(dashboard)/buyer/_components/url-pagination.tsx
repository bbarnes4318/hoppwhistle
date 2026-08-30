'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { Pagination } from '@/components/domain';

/** Pagination that moves the page through the URL, so the server refetches. */
export function UrlPagination({
  page,
  pageSize,
  total,
  noun = 'rows',
  param = 'page',
}: {
  page: number;
  pageSize: number;
  total: number | null;
  noun?: string;
  param?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  return (
    <Pagination
      page={page}
      pageSize={pageSize}
      total={total}
      noun={noun}
      disabled={pending}
      onPageChange={next => {
        const q = new URLSearchParams(params.toString());
        if (next <= 1) q.delete(param);
        else q.set(param, String(next));
        const qs = q.toString();
        startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
      }}
    />
  );
}
