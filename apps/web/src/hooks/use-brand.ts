'use client';

import { useMemo } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { resolveBrand, type ActiveBrand } from '@/lib/brand-themes';

/** The product name when no agency brand is active. */
export const DEFAULT_PRODUCT_NAME = 'NetEnroll';

export interface BrandState {
  /** The agency's theme, or null for the default NetEnroll look. */
  brand: ActiveBrand | null;
  /**
   * False until `/api/auth/me` has answered. While it is false the shell draws
   * NO logo and names no product: drawing NetEnroll's and then swapping it for
   * the agency's is exactly the flash a white-labelled user must not see.
   */
  settled: boolean;
  /** What the product is called on this screen. */
  productName: string;
}

/**
 * The brand for the signed-in principal, straight from `/api/auth/me`.
 *
 * The server decides it -- the user's own agency, or the agency a platform
 * admin has entered -- so this reads the session and nothing else.
 */
export function useBrand(): BrandState {
  const { user, status } = useAuth();
  const serverBrand = user?.brand;
  const brand = useMemo(() => resolveBrand(serverBrand), [serverBrand]);
  return {
    brand,
    settled: status !== 'resolving',
    productName: brand?.name ?? DEFAULT_PRODUCT_NAME,
  };
}
