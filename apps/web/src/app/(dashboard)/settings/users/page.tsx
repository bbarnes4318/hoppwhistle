'use client';

import { AlertTriangle, Building2, Loader2, Mail, MapPin, Plus, Shield } from 'lucide-react';
import { useState, useEffect } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { InviteUserDialog } from '@/components/users/invite-user-dialog';
import { LicensedStatesDialog } from '@/components/users/licensed-states-dialog';
import { PendingApprovals } from '@/components/users/pending-approvals';
import { useAuth } from '@/hooks/use-auth';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient } from '@/lib/api';
import { jurisdictionName } from '@/lib/licensable-jurisdictions';

interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  status: string;
  roles: string[];
  buyerId?: string | null;
  buyerName?: string | null;
  buyerCode?: string | null;
  invitedAt: string;
  lastLoginAt: string | null;
  /** Normalised by the server; absent on a row written before it validated. */
  licensedStates?: string[];
}

/**
 * Only an agent is gated on a licence.
 *
 * `lib/licensed-states.ts` restricts a principal that holds AGENT and is not
 * staff, so showing an empty licence beside an owner or a buyer would report a
 * gap that does not exist and send somebody granting licences to people who do
 * not need them.
 */
function isLicenceGated(user: User): boolean {
  const roles = user.roles.map(role => role.toUpperCase());
  return roles.includes('AGENT') && !roles.includes('OWNER') && !roles.includes('ADMIN');
}

/**
 * One agent's licence, read at a glance.
 *
 * Three states, and the middle one is the reason this column exists. An empty
 * licence is not a blank cell: it is default-deny in force, and an
 * administrator scanning this table needs to see that it is the reason an agent
 * is getting no work -- not wonder whether the column failed to load.
 */
function LicenceCell({ user }: { user: User }): JSX.Element {
  if (!isLicenceGated(user)) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  const states = user.licensedStates ?? [];

  if (states.length === 0) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"
        title="No licence recorded. This agent is served no leads and routed no state-identified calls."
      >
        <AlertTriangle className="h-3 w-3" />
        None recorded
      </span>
    );
  }

  // Six is what fits on one line at this width; the rest go behind a count
  // rather than wrapping the row to three lines.
  const shown = states.slice(0, 6);
  const rest = states.length - shown.length;

  return (
    <div
      className="flex flex-wrap items-center gap-1"
      title={states.map(jurisdictionName).join(', ')}
    >
      {shown.map(code => (
        <Badge key={code} variant="outline" className="px-1.5 py-0 font-mono text-[10px]">
          {code}
        </Badge>
      ))}
      {rest > 0 ? <span className="text-xs text-muted-foreground">+{rest}</span> : null}
    </div>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [licenceUser, setLicenceUser] = useState<User | null>(null);
  const { hasFullAccess } = useAuth();

  // The API returns status lowercased. Approving is admin-only on the server,
  // so a non-admin is not offered buttons that would come back 403.
  const pendingUsers = users.filter(u => u.status?.toLowerCase() === 'pending');
  const activeUsers = users.filter(u => u.status?.toLowerCase() !== 'pending');

  /*
   * The user list belongs to one agency, and this page is reachable without one.
   *
   * /settings is in PLATFORM_WIDE_PREFIXES so NetEnroll staff can open it with
   * no agency entered. There is no cross-agency reading of a user list, so
   * asking for one with no acting tenant is a request the server refuses 409 —
   * twice per load, for a table that could never have rendered. The browser
   * smoke test found this; it is the same shape as the defect Phase 5 fixed on
   * /delivery.
   */
  const platform = usePlatformContext();
  const withoutAgency = platform.needsAgency;

  useEffect(() => {
    if (platform.loading) return;
    if (withoutAgency) {
      setUsers([]);
      setLoading(false);
      return;
    }
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform.loading, withoutAgency]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get<{ data: User[] }>('/api/v1/users');
      if (response.data?.data) {
        setUsers(response.data.data);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role.toLowerCase()) {
      case 'admin':
      case 'owner':
        return 'default';
      case 'buyer':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between flex-shrink-0 mb-4">
        <div>
          <p className="text-muted-foreground">Manage team members and permissions</p>
        </div>
        <Button onClick={() => setInviteDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Invite User
        </Button>
      </div>

      {hasFullAccess && <PendingApprovals users={pendingUsers} onDecided={loadUsers} />}

      <Card className="flex-1 flex flex-col overflow-hidden min-h-0">
        <CardHeader className="flex-shrink-0">
          <CardTitle>Team Members</CardTitle>
          <CardDescription>View and manage user access</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : withoutAgency ? (
            <div className="py-12 text-center t-body text-ink-3">
              Users belong to an agency. Enter one in the switcher above to see and manage its
              people.
            </div>
          ) : activeUsers.length === 0 ? (
            <div className="py-12 text-center t-body text-ink-3">No users found</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Buyer Company</TableHead>
                  <TableHead>Licensed states</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Invited</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeUsers.map(user => (
                  <TableRow key={user.id}>
                    <TableCell className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div>{user.email}</div>
                        {(user.firstName || user.lastName) && (
                          <div className="text-xs text-muted-foreground">
                            {[user.firstName, user.lastName].filter(Boolean).join(' ')}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {user.roles.map(role => (
                          <Badge
                            key={role}
                            variant={getRoleBadgeVariant(role)}
                            className="flex items-center gap-1 w-fit"
                          >
                            <Shield className="h-3 w-3" />
                            {role.toUpperCase()}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {user.buyerId ? (
                        <div className="flex items-center gap-1.5">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="text-sm font-medium">{user.buyerName}</div>
                            <div className="text-xs text-muted-foreground">{user.buyerCode}</div>
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <LicenceCell user={user} />
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.status === 'active' ? 'success' : 'warning'}>
                        {user.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{new Date(user.invitedAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      {/*
                        This was a dead `Edit` button with no handler. It is now
                        the licence control, and it is offered only for the
                        accounts a licence applies to.
                      */}
                      {isLicenceGated(user) ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setLicenceUser(user)}
                          disabled={!hasFullAccess}
                          title={
                            hasFullAccess
                              ? undefined
                              : 'Only an owner or administrator can change a licence'
                          }
                        >
                          <MapPin className="mr-1.5 h-3.5 w-3.5" />
                          Licence
                        </Button>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <InviteUserDialog
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
        onSuccess={loadUsers}
      />

      <LicensedStatesDialog
        open={licenceUser !== null}
        onOpenChange={open => {
          if (!open) setLicenceUser(null);
        }}
        user={licenceUser}
        onSaved={() => void loadUsers()}
      />
    </div>
  );
}
