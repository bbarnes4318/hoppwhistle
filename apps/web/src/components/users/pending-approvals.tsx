'use client';

import { Check, Clock, Loader2, Mail, X } from 'lucide-react';
import { useState } from 'react';

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
import { toast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api';

export interface PendingUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  status: string;
  roles: string[];
  invitedAt: string;
}

interface PendingApprovalsProps {
  users: PendingUser[];
  /** Refetch the user list once a decision lands. */
  onDecided: () => void;
}

/**
 * The queue of self-serve signups waiting on someone.
 *
 * Registration creates the account PENDING and hands back no session, so
 * nothing happens for these people until an administrator acts here. That makes
 * this list the one place the signup flow can silently stall -- so it renders
 * above the team table and only when it has something in it, rather than being
 * a tab somebody has to remember to open.
 *
 * Reject sets INACTIVE rather than deleting the row: a misclick is recoverable,
 * and the record of who asked for access survives. Both decisions go through
 * PATCH /api/v1/users/:userId, which is admin-only on the server -- the check
 * that matters is there, not here.
 */
export function PendingApprovals({ users, onDecided }: PendingApprovalsProps): JSX.Element | null {
  // Keyed by user id so two decisions in flight cannot disable each other's row.
  const [pendingIds, setPendingIds] = useState<Record<string, 'approve' | 'reject'>>({});

  if (users.length === 0) return null;

  const decide = async (user: PendingUser, decision: 'approve' | 'reject') => {
    setPendingIds(current => ({ ...current, [user.id]: decision }));
    try {
      const response = await apiClient.patch(`/api/v1/users/${user.id}`, {
        status: decision === 'approve' ? 'ACTIVE' : 'INACTIVE',
      });

      if (response.error) throw new Error(response.error.message);

      toast({
        title: decision === 'approve' ? 'Account approved' : 'Account rejected',
        description:
          decision === 'approve'
            ? `${user.email} can now sign in.`
            : `${user.email} cannot sign in. You can re-approve them later.`,
      });
      onDecided();
    } catch (err) {
      toast({
        title: decision === 'approve' ? 'Could not approve' : 'Could not reject',
        description: err instanceof Error ? err.message : 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setPendingIds(current => {
        const next = { ...current };
        delete next[user.id];
        return next;
      });
    }
  };

  return (
    <Card className="mb-4 border-amber-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-amber-500" />
          Waiting for approval
          <Badge variant="warning">{users.length}</Badge>
        </CardTitle>
        <CardDescription>
          These people signed up and cannot sign in until someone approves them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Signed up</TableHead>
              <TableHead className="text-right">Decision</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map(user => {
              const busy = pendingIds[user.id];
              return (
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
                      {user.roles.length === 0 ? (
                        <span className="text-muted-foreground text-sm">none yet</span>
                      ) : (
                        user.roles.map(role => (
                          <Badge key={role} variant="outline" className="w-fit">
                            {role.toUpperCase()}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{new Date(user.invitedAt).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!!busy}
                        onClick={() => void decide(user, 'reject')}
                      >
                        {busy === 'reject' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                        <span className="ml-1.5">Reject</span>
                      </Button>
                      <Button
                        size="sm"
                        disabled={!!busy}
                        onClick={() => void decide(user, 'approve')}
                      >
                        {busy === 'approve' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                        <span className="ml-1.5">Approve</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
