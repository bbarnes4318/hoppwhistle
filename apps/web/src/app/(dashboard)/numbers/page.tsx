'use client';

import { ArrowRightLeft, Download, Edit2, Loader2, Plus, Search } from 'lucide-react';
import { useState, useEffect } from 'react';

import { RoleGuard } from '@/components/auth/role-guard';
import { CompactPageShell, CompactPageHeader } from '@/components/layout/compact-layout';
import { BulkvsPurchaseDialog } from '@/components/numbers/bulkvs-purchase-dialog';
import { CreateRouteDialog } from '@/components/numbers/create-route-dialog';
import { EditNumberDialog } from '@/components/numbers/edit-number-dialog';
import { EditRouteDialog } from '@/components/numbers/edit-route-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api';
import { formatPhoneNumber } from '@/lib/utils';

interface PhoneNumber {
  id: string;
  number: string;
  status: string;
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

function NumbersPage() {
  const [search, setSearch] = useState('');
  const [bulkvsPurchaseDialogOpen, setBulkvsPurchaseDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [createRouteOpen, setCreateRouteOpen] = useState(false);
  const [editRouteOpen, setEditRouteOpen] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState<PhoneNumber | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<DidRoute | null>(null);
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [routes, setRoutes] = useState<DidRoute[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(true);

  useEffect(() => {
    void loadNumbers();
    void loadRoutes();
  }, []);

  const loadNumbers = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get<{ data: PhoneNumber[] }>('/api/v1/numbers');
      if (response.data?.data) {
        setNumbers(response.data.data);
      }
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
      (n.campaign?.name || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.xlsx,.xls';
    input.onchange = e => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        toast({
          title: 'Feature Coming Soon',
          description: `Import functionality coming soon. Selected file: ${file.name}`,
        });
      }
    };
    input.click();
  };

  const handleBuyBulkvsNumber = () => {
    setBulkvsPurchaseDialogOpen(true);
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
    <CompactPageShell>
      <CompactPageHeader
        title="Numbers & Routing"
        subtitle="Manage your phone numbers and inbound call routes"
      >
        <Button
          variant="outline"
          size="sm"
          onClick={handleImport}
          className="h-8 text-xs border-border/50 text-muted-foreground"
        >
          <Download className="mr-2 h-3.5 w-3.5" />
          Import
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="h-8 text-xs">
              <Plus className="mr-2 h-3.5 w-3.5" />
              Buy Number
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-slate-900 border-white/10 text-white">
            <DropdownMenuLabel className="text-xs text-gray-400">Select Provider</DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuItem
              onClick={handleBuyBulkvsNumber}
              className="focus:bg-cyan-600 focus:text-white text-xs"
            >
              Buy from Hopwhistle
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CompactPageHeader>

      <Tabs defaultValue="numbers" className="w-full flex-1 min-h-0 flex flex-col gap-3">
        <TabsList className="mb-0 self-start">
          <TabsTrigger value="numbers" className="text-xs h-8">
            Phone Numbers
          </TabsTrigger>
          <TabsTrigger value="routing" className="text-xs h-8">
            Inbound Routes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="numbers" className="m-0 flex-1 min-h-0 overflow-hidden">
          <Card className="h-full flex flex-col overflow-hidden min-h-0 bg-card border-border/40 shadow-sm">
            <CardHeader className="flex-shrink-0 py-2 px-3 border-b border-border/10">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Phone Numbers
                  </CardTitle>
                  <CardDescription className="text-[10px]">
                    Search and manage your numbers
                  </CardDescription>
                </div>
                <div className="relative w-48">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="numbers-search"
                    name="numbers-search"
                    placeholder="Search numbers..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-8 h-7 text-xs bg-background border-border/50 text-foreground"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-grow min-h-0 overflow-auto p-3">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredNumbers.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-xs">
                  No phone numbers found
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {filteredNumbers.map(number => (
                    <div
                      key={number.id}
                      className="flex flex-col rounded border border-border bg-card p-3 transition-all hover:border-primary/50 hover:shadow-sm"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="space-y-0.5">
                          <div className="font-mono text-sm font-semibold tracking-tight text-white">
                            {formatPhoneNumber(number.number)}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant={number.status === 'ACTIVE' ? 'success' : 'secondary'}
                              className="text-[8px] px-1 py-0"
                            >
                              {number.status}
                            </Badge>
                            {number.poolType === 'POOL' && (
                              <Badge
                                variant={number.poolStatus === 'AVAILABLE' ? 'success' : 'warning'}
                                className="text-[8px] px-1 py-0"
                              >
                                RTB: {number.poolStatus === 'AVAILABLE' ? 'AVAIL' : 'ASSIGNED'}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 rounded-full"
                          onClick={() => handleEdit(number)}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      <div className="mt-2 border-t border-border/10 pt-2 space-y-1.5 text-[11px]">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <div className="text-muted-foreground text-[9px] uppercase tracking-wider">
                              Campaign
                            </div>
                            <div
                              className="font-medium truncate text-white"
                              title={number.campaign?.name || 'Unassigned'}
                            >
                              {number.campaign?.name || 'Unassigned'}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground text-[9px] uppercase tracking-wider">
                              Purchased
                            </div>
                            <div className="font-medium text-white">
                              {number.purchasedAt
                                ? new Date(number.purchasedAt).toLocaleDateString()
                                : 'N/A'}
                            </div>
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground text-[9px] uppercase tracking-wider">
                            Assigned Agent
                          </div>
                          <div
                            className="font-medium truncate text-white"
                            title={number.user?.name || 'Unassigned'}
                          >
                            {number.user?.name || 'Unassigned'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="routing" className="m-0 flex-1 min-h-0 overflow-hidden">
          <Card className="h-full flex flex-col overflow-hidden min-h-0 bg-card border-border/40 shadow-sm">
            <CardHeader className="flex-shrink-0 py-2 px-3 border-b border-border/10">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Inbound Routes
                  </CardTitle>
                  <CardDescription className="text-[10px]">
                    Map your DIDs to buyer destinations for inbound calls
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative w-48">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="routes-search"
                      name="routes-search"
                      placeholder="Search routes..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="pl-8 h-7 text-xs bg-background border-border/50 text-foreground"
                    />
                  </div>
                  <Button
                    onClick={() => setCreateRouteOpen(true)}
                    size="sm"
                    className="h-7 text-xs"
                  >
                    <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
                    Create Route
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-grow min-h-0 overflow-auto p-3">
              {loadingRoutes ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredRoutes.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-xs">
                  No routing rules found
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {filteredRoutes.map(route => (
                    <div
                      key={route.id}
                      className="flex flex-col rounded border border-border bg-card p-3 transition-all hover:border-primary/50 hover:shadow-sm"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="space-y-0.5">
                          <div className="font-mono text-sm font-semibold tracking-tight text-cyan-400">
                            {formatPhoneNumber(route.did)}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant={route.status === 'ACTIVE' ? 'success' : 'secondary'}
                              className="text-[8px] px-1 py-0"
                            >
                              {route.status}
                            </Badge>
                            {route.recordingEnabled && (
                              <Badge
                                variant="outline"
                                className="text-[8px] px-1 py-0 border-blue-500/30 text-blue-400 bg-blue-500/10 animate-none"
                              >
                                REC
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 rounded-full"
                          onClick={() => handleEditRoute(route)}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      <div className="space-y-2 border-t border-border/10 pt-2 text-[11px] mt-2">
                        <div>
                          <div className="text-muted-foreground text-[9px] uppercase tracking-wider flex items-center gap-1">
                            <ArrowRightLeft className="h-3 w-3" /> Destination
                          </div>
                          <div className="font-mono text-xs text-white">
                            {formatPhoneNumber(route.destination)}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <div className="text-muted-foreground text-[9px] uppercase tracking-wider">
                              Label / Buyer
                            </div>
                            <div
                              className="font-medium truncate text-white"
                              title={route.label || route.buyer?.name || 'Unassigned'}
                            >
                              {route.label || route.buyer?.name || 'Unassigned'}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground text-[9px] uppercase tracking-wider">
                              Created
                            </div>
                            <div className="font-medium text-white">
                              {route.createdAt
                                ? new Date(route.createdAt).toLocaleDateString()
                                : 'N/A'}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <BulkvsPurchaseDialog
        open={bulkvsPurchaseDialogOpen}
        onOpenChange={setBulkvsPurchaseDialogOpen}
        onSuccess={handlePurchaseSuccess}
      />

      <CreateRouteDialog
        open={createRouteOpen}
        onOpenChange={setCreateRouteOpen}
        availableNumbers={numbers as any}
        onSuccess={loadRoutes}
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
          onSuccess={loadRoutes}
        />
      )}
    </CompactPageShell>
  );
}

export default function GuardedNumbersPage() {
  return (
    <RoleGuard allowedRoles={['ADMIN', 'OWNER']}>
      <NumbersPage />
    </RoleGuard>
  );
}
