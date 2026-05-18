'use client';

import { Plus, Search, Download, Loader2, ArrowRightLeft } from 'lucide-react';
import { useState, useEffect } from 'react';
import { toast } from '@/components/ui/use-toast';

import { AnveoPurchaseDialog } from '@/components/numbers/anveo-purchase-dialog';
import { EditNumberDialog } from '@/components/numbers/edit-number-dialog';
import { BulkvsPurchaseDialog } from '@/components/numbers/bulkvs-purchase-dialog';
import { CreateRouteDialog } from '@/components/numbers/create-route-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
 Table,
 TableBody,
 TableCell,
 TableHead,
 TableHeader,
 TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiClient } from '@/lib/api';
import { formatPhoneNumber } from '@/lib/utils';

interface PhoneNumber {
 id: string;
 number: string;
 status: string;
 poolType?: 'POOL' | 'STATIC' | 'BUYER' | null;
 poolStatus?: 'AVAILABLE' | 'ASSIGNED' | 'RESERVED' | null;
 campaign: { id: string; name: string } | null;
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
 const [anveoPurchaseDialogOpen, setAnveoPurchaseDialogOpen] = useState(false);
 const [bulkvsPurchaseDialogOpen, setBulkvsPurchaseDialogOpen] = useState(false);
 const [editDialogOpen, setEditDialogOpen] = useState(false);
 const [createRouteOpen, setCreateRouteOpen] = useState(false);
 const [selectedNumber, setSelectedNumber] = useState<PhoneNumber | null>(null);
 const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
 const [loading, setLoading] = useState(true);
 const [routes, setRoutes] = useState<DidRoute[]>([]);
 const [loadingRoutes, setLoadingRoutes] = useState(true);

 useEffect(() => {
 loadNumbers();
 loadRoutes();
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
 toast({ title: 'Feature Coming Soon', description: `Import functionality coming soon. Selected file: ${file.name}` });
 }
 };
 input.click();
 };

 const handleBuyAnveoNumber = () => {
 setAnveoPurchaseDialogOpen(true);
 };

 const handleBuyBulkvsNumber = () => {
 setBulkvsPurchaseDialogOpen(true);
 };

 const handlePurchaseSuccess = () => {
 loadNumbers();
 };

 const handleEdit = (number: PhoneNumber) => {
 setSelectedNumber(number);
 setEditDialogOpen(true);
 };

 const handleEditSuccess = () => {
 loadNumbers();
 };

 const filteredRoutes = routes.filter(
 r => r.did.includes(search) || r.destination.includes(search) || r.label?.toLowerCase().includes(search.toLowerCase())
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
 <DropdownMenuItem onClick={handleBuyAnveoNumber}>
 Buy from Anveo Direct
 </DropdownMenuItem>
 <DropdownMenuItem onClick={handleBuyBulkvsNumber}>
 Buy from BulkVS
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
 <div className="text-center py-12 text-muted-foreground">No phone numbers found</div>
 ) : (
 <Table>
 <TableHeader>
 <TableRow>
 <TableHead>Number</TableHead>
 <TableHead>Status</TableHead>
 <TableHead>RTB Pool</TableHead>
 <TableHead>Campaign</TableHead>
 <TableHead>Purchased</TableHead>
 <TableHead className="text-right">Actions</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {filteredNumbers.map(number => (
 <TableRow key={number.id}>
 <TableCell className="font-mono">{formatPhoneNumber(number.number)}</TableCell>
 <TableCell>
 <Badge variant={number.status === 'ACTIVE' ? 'success' : 'secondary'}>
 {number.status.toLowerCase()}
 </Badge>
 </TableCell>
 <TableCell>
 {number.poolType === 'POOL' ? (
 <Badge variant={number.poolStatus === 'AVAILABLE' ? 'success' : 'warning'}>
 {number.poolStatus === 'AVAILABLE' ? '✓ Available' : 'Assigned'}
 </Badge>
 ) : (
 <span className="text-muted-foreground text-sm">Static</span>
 )}
 </TableCell>
 <TableCell>{number.campaign?.name || '-'}</TableCell>
 <TableCell>
 {number.purchasedAt ? new Date(number.purchasedAt).toLocaleDateString() : '-'}
 </TableCell>
 <TableCell className="text-right">
 <Button variant="ghost" size="sm" onClick={() => handleEdit(number)}>
 Edit
 </Button>
 </TableCell>
 </TableRow>
 ))}
 </TableBody>
 </Table>
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
 <CardDescription>Map your DIDs to buyer destinations for inbound calls</CardDescription>
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
 <div className="text-center py-12 text-muted-foreground">No routing rules found</div>
 ) : (
 <Table>
 <TableHeader>
 <TableRow>
 <TableHead>DID (Inbound)</TableHead>
 <TableHead>Destination (Buyer)</TableHead>
 <TableHead>Label / Buyer</TableHead>
 <TableHead>Status</TableHead>
 <TableHead>Recording</TableHead>
 <TableHead>Created</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {filteredRoutes.map(route => (
 <TableRow key={route.id}>
 <TableCell className="font-mono">{formatPhoneNumber(route.did)}</TableCell>
 <TableCell className="font-mono text-muted-foreground">{formatPhoneNumber(route.destination)}</TableCell>
 <TableCell>{route.label || route.buyer?.name || '-'}</TableCell>
 <TableCell>
 <Badge variant={route.status === 'ACTIVE' ? 'success' : 'secondary'}>
 {route.status.toLowerCase()}
 </Badge>
 </TableCell>
 <TableCell>
 {route.recordingEnabled ? (
 <Badge variant="outline" className="bg-blue-500/10 text-blue-400">Enabled</Badge>
 ) : (
 <span className="text-muted-foreground text-sm">Disabled</span>
 )}
 </TableCell>
 <TableCell>
 {route.createdAt ? new Date(route.createdAt).toLocaleDateString() : '-'}
 </TableCell>
 </TableRow>
 ))}
 </TableBody>
 </Table>
 )}
 </CardContent>
 </Card>
 </TabsContent>
 </Tabs>

 <AnveoPurchaseDialog
 open={anveoPurchaseDialogOpen}
 onOpenChange={setAnveoPurchaseDialogOpen}
 onSuccess={handlePurchaseSuccess}
 />

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
 currentCapabilities={selectedNumber.capabilities}
 currentPoolType={selectedNumber.poolType}
 currentPoolStatus={selectedNumber.poolStatus}
 onSuccess={handleEditSuccess}
 />
 )}
 </div>
 );
}

