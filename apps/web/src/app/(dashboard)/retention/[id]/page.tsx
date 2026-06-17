'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';



export default function PolicyDetailPage(): JSX.Element | null {
  const router = useRouter();
  useEffect(() => {
    router.replace('/insurance-leads');
  }, [router]);
  return null;
}
