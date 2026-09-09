'use client';

import {
  Upload,
  Users,
  ArrowRight,
  ArrowLeft,
  Settings,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

interface Lead {
  id: string;
  phone: string;
  name?: string;
  status: 'pending' | 'calling' | 'success' | 'failed' | 'no_answer';
}

export interface LeadUploadError {
  type: 'invalid_file' | 'missing_phone' | 'empty_file' | 'upload_failed';
  message: string;
}

interface Step3LeadsCampaignProps {
  leads: Lead[];
  onUploadLeads: (e: React.ChangeEvent<HTMLInputElement>) => void;
  concurrency: number;
  onConcurrencyChange: (value: number) => void;
  onContinue: () => void;
  onBack: () => void;
  uploadError?: LeadUploadError | null;
  onClearError?: () => void;
}

export function Step3LeadsCampaign({
  leads,
  onUploadLeads,
  concurrency,
  onConcurrencyChange,
  onContinue,
  onBack,
  uploadError,
  onClearError,
}: Step3LeadsCampaignProps) {
  const canContinue = leads.length > 0 && !uploadError;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (onClearError) onClearError();
    onUploadLeads(e);
  };

  return (
    <div className="space-y-6">
      {/* Lead Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Upload Your Leads
          </CardTitle>
          <CardDescription>Upload a CSV file with phone numbers to call</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Label htmlFor="leads-upload" className="cursor-pointer block">
            <div className="flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed border-muted-foreground/25 px-6 py-12 hover:bg-sunken hover:border-primary/50 transition-colors">
              <Upload className="h-12 w-12 text-muted-foreground" />
              <div className="text-center">
                <p className="font-medium text-lg">Drop your CSV here or click to browse</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Format: phone number in first column, name (optional) in second
                </p>
              </div>
            </div>
          </Label>
          <Input
            id="leads-upload"
            type="file"
            accept=".csv,.txt"
            onChange={handleFileChange}
            className="hidden"
          />

          {/* Upload Error */}
          {uploadError && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-dropped-tint border border-dropped/40">
              <AlertCircle className="h-5 w-5 text-dropped-ink shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-dropped-ink">Upload failed</p>
                <p className="text-sm text-dropped-ink mt-1">{uploadError.message}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => document.getElementById('leads-upload')?.click()}
                className="shrink-0 border-dropped/40 text-dropped-ink hover:bg-dropped-tint"
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Try Again
              </Button>
            </div>
          )}

          {/* Empty State */}
          {leads.length === 0 && !uploadError && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-sunken border border-dashed">
              <Users className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Upload a CSV to see lead count and enable calling.
              </p>
            </div>
          )}

          {/* Lead Count Preview */}
          {leads.length > 0 && (
            <div className="flex items-center justify-between p-4 rounded-lg bg-live-tint border border-live/40">
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-live-ink" />
                <span className="font-medium text-live-ink">{leads.length} leads uploaded</span>
              </div>
              <Badge variant="outline" className="border-live text-live-ink">
                Ready
              </Badge>
            </div>
          )}

          {/* Lead Preview Table */}
          {leads.length > 0 && (
            <div className="rounded-lg border max-h-[200px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="p-2 text-left font-medium">Phone</th>
                    <th className="p-2 text-left font-medium">Name</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.slice(0, 5).map(lead => (
                    <tr key={lead.id} className="border-t">
                      <td className="p-2 font-mono">{lead.phone}</td>
                      <td className="p-2 text-muted-foreground">{lead.name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {leads.length > 5 && (
                <p className="p-2 text-center text-xs text-muted-foreground border-t">
                  + {leads.length - 5} more leads
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Campaign Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            Campaign Settings
          </CardTitle>
          <CardDescription>Configure how aggressively to make calls</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Concurrency Slider */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Concurrent Calls</Label>
              <span className="text-2xl font-bold text-primary">{concurrency}</span>
            </div>
            <Slider
              value={[concurrency]}
              onValueChange={([value]) => onConcurrencyChange(value)}
              min={1}
              max={10}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>1 (Slow & Steady)</span>
              <span>10 (Maximum Speed)</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Higher concurrency means faster calling but requires more agent availability.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button onClick={onBack} variant="outline" className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button onClick={onContinue} disabled={!canContinue} size="lg" className="gap-2">
          Continue to Review
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
