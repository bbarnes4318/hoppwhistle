'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function RetentionPage(): JSX.Element | null {
  const router = useRouter();
  useEffect(() => {
    router.replace('/insurance-leads');
  }, [router]);
  return null;
}
