'use client';

import { useAuth } from '@/hooks/use-auth';
import { usePlatformContext } from '@/hooks/use-platform-context';

/**
 * Whether this screen should be drawn the agent's way: AgentToday on
 * /dashboard, and no live strip above every page.
 *
 * `isAgentOnly` alone is not the answer, for the same reason `isWhiteLabel` is
 * not in `useWhiteLabelView`: a NetEnroll operator can hold AGENT on their own
 * account, and their experience -- PLATFORM_NAV, the platform dashboard, the
 * platform strip -- is not an agent's. An operator PREVIEWING an agency as
 * AGENT is looking at the agent's portal, and gets it exactly; that is what the
 * preview is for. The same rule `navFor` applies to the sidebar.
 */
export function useAgentView(): boolean {
  const { isAgentOnly, isPlatformAdmin, user } = useAuth();
  const platform = usePlatformContext();
  const previewing = platform.previewRole != null || user?.previewRole != null;
  return isAgentOnly && (!isPlatformAdmin || previewing);
}
