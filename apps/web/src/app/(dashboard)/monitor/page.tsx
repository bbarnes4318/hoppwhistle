'use client';

import { AgentFloor } from '@/components/agents/agent-floor';

/**
 * Live floor: every agent live, and Listen on any call in progress.
 *
 * The home of an agency MANAGER, and open to the agency's OWNER and ADMINs as
 * well -- the floor is the same one the white-label Agents hub opens on. The
 * API decides who may read it (`requireFloorSupervisor`); Listen rings the
 * viewer's own softphone with a listen-only leg on the agent's call.
 */
export default function MonitorPage(): JSX.Element {
  return <AgentFloor />;
}
