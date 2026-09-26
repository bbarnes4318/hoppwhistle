'use client';

import { useAuth } from '@/hooks/use-auth';
import { usePlatformContext } from '@/hooks/use-platform-context';

/**
 * Whether this screen should be drawn the white-label owner's way.
 *
 * `isWhiteLabel` alone is not the answer: NetEnroll staff inside a white-label
 * agency carry its OWNER and ADMIN, so it reads true for them too, and their
 * experience -- PLATFORM_NAV, every page as it always was -- is not changing.
 * Staff PREVIEWING the agency as one of those roles are looking at the owner's
 * portal, and get the owner's structure; that is what the preview is for.
 *
 * The same rule the sidebar applies through `navFor`, and the dashboard's
 * Sales Today panel applied before it.
 */
export function useWhiteLabelView(): boolean {
  const { isWhiteLabel, isPlatformAdmin, user } = useAuth();
  const platform = usePlatformContext();
  const previewing = platform.previewRole != null || user?.previewRole != null;
  return isWhiteLabel && (!isPlatformAdmin || previewing);
}
