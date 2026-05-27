'use client';

import { ArrowRightLeft, Download, Edit2, Loader2, Plus, Search } from 'lucide-react';
import { useState, useEffect } from 'react';

import { BulkvsPurchaseDialog } from '@/components/numbers/bulkvs-purchase-dialog';
import { CreateRouteDialog } from '@/components/numbers/create-route-dialog';
import { EditNumberDialog } from '@/components/numbers/edit-number-dialog';
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

export default function NumbersPage() {
  const [search, setSearch] = useState('');
  const [bulkvsPurchaseDialogOpen, setBulkvsPurchaseDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [createRouteOpen, setCreateRouteOpen] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState<PhoneNumber | null>(null);
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
    n => n.number.includes(search) || n.campaign?.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleImport = () => {
    // Create a file input element
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.xlsx,.xls';
    input.onchange = e => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        // TODO: Implement actual import logic
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

  const filteredRoutes = routes.filter(
    r =>
      r.did.includes(search) ||
      r.destination.includes(search) ||
      r.label?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-3xl font-bold">Numbers & Routing</h1>
          <p className="text-muted-foreground">Manage your phone numbers and inbound call routes</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleImport}>
            <Download className="mr-2 h-4 w-4" />
            Import
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Buy Number
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Select Provider</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleBuyBulkvsNumber}>
                Buy from Hopwhistle
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Tabs defaultValue="numbers" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="numbers">Phone Numbers</TabsTrigger>
          <TabsTrigger value="routing">Inbound Routes</TabsTrigger>
        </TabsList>

        <TabsContent value="numbers" className="m-0">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Phone Numbers</CardTitle>
                  <CardDescription>Search and manage your numbers</CardDescription>
                </div>
                <div className="relative w-64">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="numbers-search"
                    name="numbers-search"
                    placeholder="Search numbers..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : filteredNumbers.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No phone numbers found
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {filteredNumbers.map(number => (
                    <div
                      key={number.id}
                      className="flex flex-col rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/50 hover:shadow-sm"
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="space-y-1">
                          <div className="font-mono text-lg font-semibold tracking-tight">
                            {formatPhoneNumber(number.number)}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={number.status === 'ACTIVE' ? 'success' : 'secondary'}
                              className="text-[10px] px-1.5 py-0"
                            >
                              {number.status}
                            </Badge>
                            {number.poolType === 'POOL' && (
                              <Badge
                                variant={number.poolStatus === 'AVAILABLE' ? 'success' : 'warning'}
                                className="text-[10px] px-1.5 py-0"
                              >
                                RTB: {number.poolStatus === 'AVAILABLE' ? 'AVAIL' : 'ASSIGNED'}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-full"
                          onClick={() => handleEdit(number)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="mt-auto border-t border-border/50 pt-4 space-y-2 text-sm">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <div className="text-muted-foreground text-xs uppercase tracking-wider mb-1">
                              Campaign
                            </div>
                            <div
                              className="font-medium truncate"
                              title={number.campaign?.name || 'Unassigned'}
                            >
                              {number.campaign?.name || 'Unassigned'}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground text-xs uppercase tracking-wider mb-1">
                              Purchased
                            </div>
                            <div className="font-medium">
                              {number.purchasedAt
                                ? new Date(number.purchasedAt).toLocaleDateString()
                                : 'N/A'}
                            </div>
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground text-xs uppercase tracking-wider mb-1">
                            Assigned Agent
                          </div>
                          <div className="font-medium truncate" title={number.user?.name || 'Unassigned'}>
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

        <TabsContent value="routing" className="m-0">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Inbound Routes</CardTitle>
                  <CardDescription>
                    Map your DIDs to buyer destinations for inbound calls
                  </CardDescription>
                </div>
                <div className="flex items-center gap-4">
                  <div className="relative w-64">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="routes-search"
                      name="routes-search"
                      placeholder="Search routes..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <Button onClick={() => setCreateRouteOpen(true)}>
                    <ArrowRightLeft className="mr-2 h-4 w-4" />
                    Create Route
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loadingRoutes ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : filteredRoutes.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No routing rules found
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {filteredRoutes.map(route => (
                    <div
                      key={route.id}
                      className="flex flex-col rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/50 hover:shadow-sm"
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="space-y-1">
                          <div className="font-mono text-lg font-semibold tracking-tight text-primary">
                            {formatPhoneNumber(route.did)}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={route.status === 'ACTIVE' ? 'success' : 'secondary'}
                              className="text-[10px] px-1.5 py-0"
                            >
                              {route.status}
                            </Badge>
                            {route.recordingEnabled && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 border-blue-500/30 text-blue-400 bg-blue-500/10"
                              >
                                REC
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4 border-t border-border/50 pt-4 text-sm mt-auto">
                        <div>
                          <div className="text-muted-foreground text-xs uppercase tracking-wider mb-1 flex items-center gap-1">
                            <ArrowRightLeft className="h-3 w-3" /> Destination
                          </div>
                          <div className="font-mono text-base">
                            {formatPhoneNumber(route.destination)}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <div className="text-muted-foreground text-xs uppercase tracking-wider mb-1">
                              Label / Buyer
                            </div>
                            <div
                              className="font-medium truncate"
                              title={route.label || route.buyer?.name || 'Unassigned'}
                            >
                              {route.label || route.buyer?.name || 'Unassigned'}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground text-xs uppercase tracking-wider mb-1">
                              Created
                            </div>
                            <div className="font-medium">
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
    </div>
  );
}
