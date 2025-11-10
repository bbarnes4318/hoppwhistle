'use client';

import { Plus, Search, Download, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';

import { EditNumberDialog } from '@/components/numbers/edit-number-dialog';
import { PurchaseNumberDialog } from '@/components/numbers/purchase-number-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiClient } from '@/lib/api';
import { formatPhoneNumber } from '@/lib/utils';

interface PhoneNumber {
  id: string;
  number: string;
  status: string;
  campaign: { id: string; name: string } | null;
  purchasedAt?: string;
  capabilities?: {
    voice?: boolean;
    sms?: boolean;
    mms?: boolean;
    fax?: boolean;
  };
}

export default function NumbersPage() {
  const [search, setSearch] = useState('');
  const [purchaseDialogOpen, setPurchaseDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState<PhoneNumber | null>(null);
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadNumbers();
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

  const filteredNumbers = numbers.filter((n) =>
    n.number.includes(search) || n.campaign?.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleImport = () => {
    // Create a file input element
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.xlsx,.xls';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        // TODO: Implement actual import logic
        alert(`Import functionality coming soon. Selected file: ${file.name}`);
      }
    };
    input.click();
  };

  const handleBuyNumber = () => {
    setPurchaseDialogOpen(true);
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

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between flex-shrink-0 mb-4">
        <div>
          <h1 className="text-3xl font-bold">Numbers</h1>
          <p className="text-muted-foreground">Manage your phone numbers and assignments</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleImport}>
            <Download className="mr-2 h-4 w-4" />
            Import
          </Button>
          <Button onClick={handleBuyNumber}>
            <Plus className="mr-2 h-4 w-4" />
            Buy Number
          </Button>
        </div>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden min-h-0">
        <CardHeader className="flex-shrink-0">
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
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto min-h-0">
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
                  <TableHead>Campaign</TableHead>
                  <TableHead>Purchased</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredNumbers.map((number) => (
                  <TableRow key={number.id}>
                    <TableCell className="font-mono">{formatPhoneNumber(number.number)}</TableCell>
                    <TableCell>
                      <Badge variant={number.status === 'ACTIVE' ? 'success' : 'secondary'}>
                        {number.status.toLowerCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>{number.campaign?.name || '-'}</TableCell>
                    <TableCell>
                      {number.purchasedAt ? new Date(number.purchasedAt).toLocaleDateString() : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(number)}
                      >
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

      <PurchaseNumberDialog
        open={purchaseDialogOpen}
        onOpenChange={setPurchaseDialogOpen}
        onSuccess={handlePurchaseSuccess}
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
          onSuccess={handleEditSuccess}
        />
      )}
    </div>
  );
}

