'use client';

import { ArrowRightLeft, Download, Edit2, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState, useEffect } from 'react';

import { RoleGuard } from '@/components/auth/role-guard';
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  StatusChip,
  Toolbar,
  ToolbarSearch,
} from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { AddExistingNumberDialog } from '@/components/numbers/add-existing-number-dialog';
import { BuyNumbersDialog, numbersUsedLine } from '@/components/numbers/buy-numbers-dialog';
import { CreateRouteDialog } from '@/components/numbers/create-route-dialog';
import { EditNumberDialog } from '@/components/numbers/edit-number-dialog';
import { EditRouteDialog } from '@/components/numbers/edit-route-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';
import { formatDisplayDate } from '@/lib/format-time';
import { cn, formatPhoneNumber } from '@/lib/utils';

interface PhoneNumber {
  id: string;
  number: string;
  status: string;
  /** Upstream the DID came from: 'anveo', 'fractel', 'bulkvs', ... */
  provider?: string | null;
  /** Linked routing carrier, when the number has one. */
  carrier?: { id: string; name: string; code: string } | null;
  poolType?: 'POOL' | 'STATIC' | 'BUYER' | null;
  poolStatus?: 'AVAILABLE' | 'ASSIGNED' | 'RESERVED' | null;
  campaign: { id: string; name: string } | null;
  user: { id: string; name: string } | null;
  purchasedAt?: string;
  capabilities?: {
    voice?: boolean;
    sms?: boolean;
    mms?: boolean;
    fax?: boolean;
  };
}

interface DidRoute {
  id: string;
  did: string;
  destination: string;
  status: string;
  recordingEnabled: boolean;
  label?: string;
  buyer?: { id: string; name: string };
  campaign?: { id: string; name: string };
  createdAt: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  anveo: 'Anveo Direct',
  bulkvs: 'BulkVS',
  fractel: 'FracTEL',
  signalwire: 'SignalWire',
  telnyx: 'Telnyx',
  twilio: 'Twilio',
  vonage: 'Vonage',
  bandwidth: 'Bandwidth',
  local: 'Local / Imported',
};

/**
 * How a number is labelled in the carrier grouping.
 *
 * A linked Carrier row is the real answer. Numbers imported before one existed
 * -- every Anveo DID pulled in by the inventory sync, until a carrier is
 * configured with numberProvider 'anveo' -- carry only `provider`, and showing
 * that is more useful than filing them all under "Unassigned".
 */
function carrierLabel(number: PhoneNumber): string {
  if (number.carrier?.name) return number.carrier.name;
  if (number.provider) return PROVIDER_LABELS[number.provider.toLowerCase()] || number.provider;
  return 'Unassigned Carrier';
}

/**
 * The confirmation a release asks for, word for word. Releasing gives the
 * number back to the carrier: nothing about it survives, so the sentence says
 * exactly that and nothing softer.
 */
export const RELEASE_CONFIRMATION = "This number stops working immediately and can't be recovered.";

/** Numbers grouped by carrier, largest group first, unassigned last. */
function groupByCarrier(
  numbers: PhoneNumber[]
): Array<{ carrier: string; numbers: PhoneNumber[] }> {
  const groups = new Map<string, PhoneNumber[]>();

  for (const number of numbers) {
    const label = carrierLabel(number);
    const existing = groups.get(label);
    if (existing) {
      existing.push(number);
    } else {
      groups.set(label, [number]);
    }
  }

  return Array.from(groups.entries())
    .map(([carrier, groupNumbers]) => ({ carrier, numbers: groupNumbers }))
    .sort((a, b) => {
      const aUnassigned = a.carrier === 'Unassigned Carrier';
      const bUnassigned = b.carrier === 'Unassigned Carrier';
      if (aUnassigned !== bUnassigned) return aUnassigned ? 1 : -1;
      if (a.numbers.length !== b.numbers.length) return b.numbers.length - a.numbers.length;
      return a.carrier.localeCompare(b.carrier);
    });
}

function NumberCard({
  number,
  onEdit,
  onRelease,
  showCarrier,
}: {
  number: PhoneNumber;
  onEdit: (number: PhoneNumber) => void;
  onRelease: (number: PhoneNumber) => void;
  /** Staff only: which carrier a number is on is the platform's business. */
  showCarrier: boolean;
}) {
  return (
    <div className="flex flex-col rounded-card border border-rule bg-surface p-3 transition-shadow hover:border-rule-strong hover:shadow-raised">
      <div className="flex items-start justify-between mb-2">
        <div className="space-y-0.5">
          <div className="t-data font-semibold text-ink">{formatPhoneNumber(number.number)}</div>
          <div className="flex items-center gap-1.5">
            <StatusChip value={number.status} size="sm" />
            {number.poolType === 'POOL' && (
              <StatusChip
                value={number.poolStatus ?? 'ASSIGNED'}
                tone={number.poolStatus === 'AVAILABLE' ? 'live' : 'ringing'}
                label={`RTB: ${number.poolStatus === 'AVAILABLE' ? 'AVAIL' : 'ASSIGNED'}`}
                size="sm"
              />
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-full"
            aria-label="Edit number"
            onClick={() => onEdit(number)}
          >
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-full text-dropped-ink hover:text-dropped-ink"
            aria-label={`Release ${formatPhoneNumber(number.number)}`}
            title="Release number"
            onClick={() => onRelease(number)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-2 border-t border-rule pt-2 space-y-1.5">
        <div className="grid grid-cols-2 gap-2">
          {showCarrier ? (
            <div>
              <div className="t-label text-ink-3">Carrier</div>
              <div className="t-body truncate text-ink" title={carrierLabel(number)}>
                {carrierLabel(number)}
              </div>
            </div>
          ) : null}
          <div>
            <div className="t-label text-ink-3">Purchased</div>
            <div className="t-body text-ink">{formatDisplayDate(number.purchasedAt)}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="t-label text-ink-3">Campaign</div>
            <div
              className={cn('t-body truncate', number.campaign?.name ? 'text-ink' : 'text-ink-3')}
              title={number.campaign?.name || 'Unassigned'}
            >
              {number.campaign?.name || 'Unassigned'}
            </div>
          </div>
          <div>
            <div className="t-label text-ink-3">Assigned Agent</div>
            <div
              className={cn('t-body truncate', number.user?.name ? 'text-ink' : 'text-ink-3')}
              title={number.user?.name || 'Unassigned'}
            >
              {number.user?.name || 'Unassigned'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NumbersPage() {
  /*
   * Who buys numbers, and who does the platform's inventory work.
   *
   * An agency's OWNER or ADMIN buys and releases its own numbers, within the
   * limit and at the price its platform (or, for a downline, its parent) sets:
   * the FracTEL and BulkVS purchase routes are open to them now, and a number
   * past the limit is refused 403 QUOTA_EXCEEDED. So "Buy numbers" is drawn
   * for them.
   *
   * "Add existing" and the Anveo sync are different: they claim numbers the
   * platform already holds at a carrier, which is inventory work, and they
   * stay NetEnroll staff's alone. So is seeing which carrier a number is on.
   */
  const { isPlatformAdmin, hasFullAccess } = useAuth();
  const canProcure = isPlatformAdmin || hasFullAccess;
  const [search, setSearch] = useState('');
  const [buyOpen, setBuyOpen] = useState(false);
  const [usage, setUsage] = useState<{ used: number; limit: number | null } | null>(null);
  const [releasing, setReleasing] = useState<PhoneNumber | null>(null);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [createRouteOpen, setCreateRouteOpen] = useState(false);
  const [editRouteOpen, setEditRouteOpen] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState<PhoneNumber | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<DidRoute | null>(null);
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [routes, setRoutes] = useState<DidRoute[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(true);
  const [syncingAnveo, setSyncingAnveo] = useState(false);
  const [addExistingOpen, setAddExistingOpen] = useState(false);

  useEffect(() => {
    void loadNumbers();
    void loadRoutes();
  }, []);

  const loadNumbers = async () => {
    setLoading(true);
    try {
      // Grouping by carrier is only honest over the whole inventory: the
      // endpoint's default page of 20 was dropping entire carriers off the page.
      const response = await apiClient.get<{
        data: PhoneNumber[];
        meta?: { numbersUsed?: number; numbersLimit?: number | null };
      }>('/api/v1/numbers?limit=500');
      if (response.data?.data) {
        setNumbers(response.data.data);
      }
      const meta = response.data?.meta;
      setUsage(
        typeof meta?.numbersUsed === 'number'
          ? { used: meta.numbersUsed, limit: meta.numbersLimit ?? null }
          : null
      );
    } catch (err) {
      console.error('Failed to load numbers:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadRoutes = async () => {
    setLoadingRoutes(true);
    try {
      const response = await apiClient.get<{ routes: DidRoute[] }>('/api/v1/did-routes');
      if (response.data?.routes) {
        setRoutes(response.data.routes);
      }
    } catch (err) {
      console.error('Failed to load routes:', err);
    } finally {
      setLoadingRoutes(false);
    }
  };

  const filteredNumbers = numbers.filter(
    n =>
      n.number.includes(search) ||
      (n.campaign?.name || '').toLowerCase().includes(search.toLowerCase()) ||
      carrierLabel(n).toLowerCase().includes(search.toLowerCase())
  );

  // Grouped by carrier for staff, who manage inventory carrier by carrier. An
  // agency sees one list: the carrier behind a number is not its concern.
  const carrierGroups = isPlatformAdmin
    ? groupByCarrier(filteredNumbers)
    : filteredNumbers.length > 0
      ? [{ carrier: 'Your numbers', numbers: filteredNumbers }]
      : [];

  /**
   * Pull the Anveo account's DIDs into our inventory.
   *
   * Numbers bought in the Anveo portal rather than through this app were never
   * written to our database, which is why they appeared nowhere on this page.
   */
  const handleSyncAnveo = async () => {
    setSyncingAnveo(true);
    try {
      // The `{}` is not decoration: the client always sends
      // `Content-Type: application/json`, and Fastify rejects an empty body
      // under that header with a 400 before the handler ever runs.
      const response = await apiClient.post<{
        success: boolean;
        data: { found: number; created: number; updated: number; unchanged: number };
      }>('/api/v1/anveo/sync', {});

      if (response.error) {
        toast({
          title: 'Anveo sync failed',
          description: response.error.message,
          variant: 'destructive',
        });
        return;
      }

      const result = response.data?.data;
      toast({
        title: 'Anveo inventory synced',
        description: result
          ? `${result.found} DID(s) on the account — ${result.created} added, ${result.updated} updated.`
          : 'Sync complete.',
      });
      void loadNumbers();
    } catch (err) {
      toast({
        title: 'Anveo sync failed',
        description: err instanceof Error ? err.message : 'Could not reach Anveo',
        variant: 'destructive',
      });
    } finally {
      setSyncingAnveo(false);
    }
  };

  /** Give a number back: DELETE, after the confirmation below. */
  const handleRelease = async () => {
    if (!releasing) return;
    setReleaseBusy(true);
    setReleaseError(null);
    try {
      const response = await apiClient.delete<{ data: { id: string; status: string } }>(
        `/api/v1/numbers/${releasing.id}`
      );
      if (response.error) {
        setReleaseError(
          response.error.code === 'RELEASE_FAILED'
            ? `The carrier refused to release it, so it is still yours. ${response.error.message}`
            : response.error.message
        );
        return;
      }
      toast({
        title: 'Number released',
        description: `${formatPhoneNumber(releasing.number)} no longer belongs to this agency.`,
      });
      setReleasing(null);
      void loadNumbers();
      void loadRoutes();
    } finally {
      setReleaseBusy(false);
    }
  };

  const handlePurchaseSuccess = () => {
    void loadNumbers();
  };

  const handleEdit = (number: PhoneNumber) => {
    setSelectedNumber(number);
    setEditDialogOpen(true);
  };

  const handleEditSuccess = () => {
    void loadNumbers();
  };

  const handleEditRoute = (route: DidRoute) => {
    setSelectedRoute(route);
    setEditRouteOpen(true);
  };

  const filteredRoutes = routes.filter(
    r =>
      r.did.includes(search) ||
      r.destination.includes(search) ||
      (r.label || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page-canvas">
      <PageHeader
        description="Manage your phone numbers and inbound call routes"
        actions={
          canProcure ? (
            <>
              {isPlatformAdmin ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAddExistingOpen(true)}
                    title="Add a number you already own at a carrier, e.g. an Anveo DID"
                  >
                    <Download className="mr-2 h-3.5 w-3.5" />
                    Add existing
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleSyncAnveo()}
                    disabled={syncingAnveo}
                    title="Import DIDs bought directly in the Anveo portal"
                  >
                    {syncingAnveo ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    )}
                    Sync Anveo
                  </Button>
                </>
              ) : null}
              <Button size="sm" onClick={() => setBuyOpen(true)}>
                <Plus className="mr-2 h-3.5 w-3.5" />
                Buy numbers
              </Button>
            </>
          ) : null
        }
      />

      <Tabs defaultValue="numbers" className="w-full">
        <TabsList className="mb-0 self-start">
          <TabsTrigger value="numbers">Phone Numbers</TabsTrigger>
          <TabsTrigger value="routing">Inbound Routes</TabsTrigger>
        </TabsList>

        <TabsContent value="numbers" className="flex flex-col gap-4">
          <Toolbar>
            <ToolbarSearch value={search} onChange={setSearch} placeholder="Search numbers..." />
            {usage ? (
              <span className="ml-auto t-meta tabular-nums text-ink-3" data-numbers-used>
                {numbersUsedLine(usage.used, usage.limit)}
              </span>
            ) : null}
          </Toolbar>
          <Panel className="min-w-0">
            <PanelBody>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-ink-3" />
                </div>
              ) : filteredNumbers.length === 0 ? (
                <div className="t-meta py-12 text-center text-ink-3">No phone numbers found</div>
              ) : (
                <div className="space-y-4">
                  {carrierGroups.map(group => (
                    <div key={group.carrier}>
                      {/* Admins manage inventory carrier by carrier: which DIDs
                          can attest on which trunk, and where a gap is. The flat
                          list made that impossible to see. */}
                      <div className="flex items-center gap-2 mb-2 pb-1 border-b border-rule">
                        <div className="t-label text-ink-3">{group.carrier}</div>
                        <span className="t-meta rounded-full bg-sunken px-2 text-ink-2 tabular-nums">
                          {group.numbers.length}
                        </span>
                      </div>
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
                        {group.numbers.map(number => (
                          <NumberCard
                            key={number.id}
                            number={number}
                            onEdit={handleEdit}
                            onRelease={target => {
                              setReleaseError(null);
                              setReleasing(target);
                            }}
                            showCarrier={isPlatformAdmin}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </PanelBody>
          </Panel>
        </TabsContent>

        <TabsContent value="routing" className="flex flex-col gap-4">
          <Toolbar>
            <ToolbarSearch value={search} onChange={setSearch} placeholder="Search routes..." />
          </Toolbar>
          <Panel className="min-w-0">
            <PanelHeader
              action={
                <Button onClick={() => setCreateRouteOpen(true)} size="sm">
                  <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
                  Create Route
                </Button>
              }
            >
              <PanelTitle>Inbound Routes</PanelTitle>
              <PanelDescription>
                Map your DIDs to buyer destinations for inbound calls
              </PanelDescription>
            </PanelHeader>
            <PanelBody>
              {loadingRoutes ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-ink-3" />
                </div>
              ) : filteredRoutes.length === 0 ? (
                <div className="t-meta py-12 text-center text-ink-3">No routing rules found</div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
                  {filteredRoutes.map(route => (
                    <div
                      key={route.id}
                      className="flex flex-col rounded-card border border-rule bg-surface p-3 transition-shadow hover:border-rule-strong hover:shadow-raised"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="space-y-0.5">
                          <div className="t-data font-semibold text-brand-ink">
                            {formatPhoneNumber(route.did)}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <StatusChip value={route.status} enumName="DidRouteStatus" size="sm" />
                            {route.recordingEnabled && (
                              <StatusChip
                                value="REC"
                                tone="neutral"
                                label="REC"
                                dot={false}
                                size="sm"
                              />
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 rounded-full"
                          aria-label="Edit route"
                          onClick={() => handleEditRoute(route)}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      <div className="space-y-2 border-t border-rule pt-2 mt-2">
                        <div>
                          <div className="t-label flex items-center gap-1 text-ink-3">
                            <ArrowRightLeft className="h-3 w-3" /> Destination
                          </div>
                          <div className="t-data text-ink">
                            {formatPhoneNumber(route.destination)}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <div className="t-label text-ink-3">Label / Buyer</div>
                            <div
                              className={cn(
                                't-body truncate',
                                route.label || route.buyer?.name ? 'text-ink' : 'text-ink-3'
                              )}
                              title={route.label || route.buyer?.name || 'Unassigned'}
                            >
                              {route.label || route.buyer?.name || 'Unassigned'}
                            </div>
                          </div>
                          <div>
                            <div className="t-label text-ink-3">Created</div>
                            <div className="t-body text-ink">
                              {formatDisplayDate(route.createdAt)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </PanelBody>
          </Panel>
        </TabsContent>
      </Tabs>

      {canProcure ? (
        <BuyNumbersDialog
          open={buyOpen}
          onOpenChange={setBuyOpen}
          onSuccess={handlePurchaseSuccess}
          isStaff={isPlatformAdmin}
        />
      ) : null}

      <Dialog
        open={releasing !== null}
        onOpenChange={next => {
          if (!next && !releaseBusy) setReleasing(null);
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>
              Release {releasing ? formatPhoneNumber(releasing.number) : 'this number'}?
            </DialogTitle>
            <DialogDescription>{RELEASE_CONFIRMATION}</DialogDescription>
          </DialogHeader>
          {releaseError ? (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {releaseError}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReleasing(null)} disabled={releaseBusy}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleRelease()}
              disabled={releaseBusy}
            >
              {releaseBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Release number
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isPlatformAdmin ? (
        <>
          <AddExistingNumberDialog
            open={addExistingOpen}
            onOpenChange={setAddExistingOpen}
            onSuccess={() => {
              toast({
                title: 'Number added',
                description: 'Calls to it now route to the campaign.',
              });
              void loadNumbers();
              void loadRoutes();
            }}
          />
        </>
      ) : null}

      <CreateRouteDialog
        open={createRouteOpen}
        onOpenChange={setCreateRouteOpen}
        availableNumbers={numbers}
        onSuccess={() => void loadRoutes()}
      />

      {selectedNumber && (
        <EditNumberDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          numberId={selectedNumber.id}
          number={selectedNumber.number}
          currentStatus={selectedNumber.status}
          currentCampaignId={selectedNumber.campaign?.id}
          currentUserId={selectedNumber.user?.id}
          currentCapabilities={selectedNumber.capabilities}
          currentPoolType={selectedNumber.poolType}
          currentPoolStatus={selectedNumber.poolStatus}
          onSuccess={handleEditSuccess}
        />
      )}

      {selectedRoute && (
        <EditRouteDialog
          open={editRouteOpen}
          onOpenChange={setEditRouteOpen}
          route={selectedRoute}
          onSuccess={() => void loadRoutes()}
        />
      )}
    </div>
  );
}

export function NumbersView() {
  return (
    <RoleGuard allowedRoles={['ADMIN', 'OWNER']}>
      <NumbersPage />
    </RoleGuard>
  );
}
