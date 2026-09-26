'use client';

import { AgentsTodayPanel } from '@/components/delivery/agents-today-table';
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
 * A white-label owner's hub over four screens that used to be four sidebar
 * entries -- the Leaderboard, Delivery's "Agents today" table, Team and Team
 * Members. Each tab is that screen's own view; the old URLs still render them
 * for everybody else.
 */
export default function AgentsPage(): JSX.Element {
  return (
    <HubTabs
      label="Agents sections"
      defaultTab="performance"
      tabs={[
        { key: 'performance', label: 'Performance', render: () => <LeaderboardView /> },
        { key: 'today', label: 'Today', render: () => <AgentsTodayPanel /> },
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
