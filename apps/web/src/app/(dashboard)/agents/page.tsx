'use client';

import { AgentFloor } from '@/components/agents/agent-floor';
import { TeamView } from '@/components/delivery/team-view';
import { HubTabs } from '@/components/hub/hub-tabs';
import { LeaderboardView } from '@/components/leaderboard/leaderboard-view';
import { TeamMembersView } from '@/components/users/team-members-view';

/**
 * The roles the roster tab invites: the agency's own people. Buyer and
 * publisher logins are issued from Buyers and Publishers, on the buyer's or
 * publisher's own Portal access.
 */
const ROSTER_INVITE_ROLES = ['AGENT', 'ADMIN', 'ANALYST'] as const;

/**
 * Agents: how the floor is doing, and who can take a call.
 *
 * A white-label owner's hub. It opens on the Floor -- every agent live, and
 * their day a click away -- and carries three screens that used to be sidebar
 * entries: the Leaderboard, Team and Team Members. Each of those tabs is that
 * screen's own view; the old URLs still render them for everybody else.
 *
 * The Floor replaced a "Today" tab (Delivery's "Agents today" table, which
 * Delivery still shows). `?tab=today` is no longer a tab, so an old link
 * lands on the default -- the Floor, which answers the same question live.
 */
export default function AgentsPage(): JSX.Element {
  return (
    <HubTabs
      label="Agents sections"
      defaultTab="floor"
      tabs={[
        { key: 'floor', label: 'Floor', render: () => <AgentFloor /> },
        { key: 'performance', label: 'Performance', render: () => <LeaderboardView /> },
        { key: 'period', label: 'Over a period', render: () => <TeamView /> },
        {
          key: 'roster',
          label: 'Roster',
          render: () => (
            <TeamMembersView
              inviteLabel="Invite agent or manager"
              inviteRoles={ROSTER_INVITE_ROLES}
            />
          ),
        },
      ]}
    />
  );
}
