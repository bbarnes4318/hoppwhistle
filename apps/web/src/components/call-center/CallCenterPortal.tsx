'use client';

import { useState, useCallback } from 'react';
import {
  Headphones,
  FileText,
  DollarSign,
  Phone,
  User,
  Settings,
  Maximize2,
  Minimize2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

import { usePhone } from '@/components/phone/phone-provider';
import { DialerControls } from './DialerControls';
import { ScriptPanel } from './ScriptPanel';
import { QuotePanel } from './QuotePanel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { type ProspectData, INITIAL_PROSPECT_DATA } from '@/lib/call-center/types';

// ============================================================================
// Call Center Portal - Main Orchestration Component
// Combines: Dialer, Script Panel, Quote Panel
// WIRED TO: hopbot's existing usePhone() hook (NOT fe-rickie's softphoneService)
// ============================================================================

type ActivePanel = 'script' | 'quotes' | 'both';

export function CallCenterPortal(): JSX.Element {
  // Using hopbot's existing phone hook
  const { currentCall, agentStatus } = usePhone();

  // Local state for prospect data
  const [prospectData, setProspectData] = useState<Partial<ProspectData>>(INITIAL_PROSPECT_DATA);
  const [activePanel, setActivePanel] = useState<ActivePanel>('both');
  const [selectedCarrier, setSelectedCarrier] = useState<string>('');
  const [isDialerExpanded, setIsDialerExpanded] = useState(true);

  // Update prospect data
  const handleDataUpdate = useCallback((updates: Partial<ProspectData>) => {
    setProspectData(prev => ({ ...prev, ...updates }));
  }, []);

  // Handle quote selection
  const handleQuoteSelect = useCallback(
    (carrier: string, planType: string, premium: number, faceAmount: number) => {
      setSelectedCarrier(carrier);
      setProspectData(prev => ({
        ...prev,
        carrier,
        planType,
        monthlyPremium: premium,
        faceAmount,
      }));
    },
    []
  );

  // Get status color
  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'available':
        return 'bg-emerald-500';
      case 'on-call':
        return 'bg-amber-500';
      case 'away':
        return 'bg-red-500';
      case 'dnd':
        return 'bg-purple-500';
      default:
        return 'bg-gray-500';
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-12 h-12 rounded-xl flex items-center justify-center',
              'bg-gradient-to-br from-cyan-500/20 to-blue-500/20',
              'border border-cyan-500/30'
            )}
          >
            <Headphones className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Call Center Portal</h1>
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className={cn('w-2 h-2 rounded-full', getStatusColor(agentStatus))} />
              <span className="capitalize">{agentStatus}</span>
              {currentCall && currentCall.state !== 'ended' && (
                <>
                  <span className="text-gray-600">•</span>
                  <span className="text-cyan-400">Active Call</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Panel Toggle */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActivePanel('script')}
            className={cn(
              'border-white/10',
              activePanel === 'script' && 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400'
            )}
          >
            <FileText className="w-4 h-4 mr-1" />
            Script
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActivePanel('quotes')}
            className={cn(
              'border-white/10',
              activePanel === 'quotes' && 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400'
            )}
          >
            <DollarSign className="w-4 h-4 mr-1" />
            Quotes
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActivePanel('both')}
            className={cn(
              'border-white/10',
              activePanel === 'both' && 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400'
            )}
          >
            <Maximize2 className="w-4 h-4 mr-1" />
            Both
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-12 gap-4 min-h-0">
        {/* Left Column - Dialer & Prospect Info */}
        <div
          className={cn(
            'flex flex-col gap-4',
            activePanel === 'both' ? 'col-span-3' : 'col-span-4'
          )}
        >
          {/* Dialer Card */}
          <Card className="bg-gradient-to-b from-slate-900/95 to-slate-950/95 border-white/10">
            <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-cyan-400" />
                <h3 className="text-white font-semibold text-sm">Dialer</h3>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-gray-400 hover:text-white"
                onClick={() => setIsDialerExpanded(!isDialerExpanded)}
              >
                {isDialerExpanded ? (
                  <Minimize2 className="w-3 h-3" />
                ) : (
                  <Maximize2 className="w-3 h-3" />
                )}
              </Button>
            </CardHeader>
            <CardContent className="p-4 pt-2">
              <DialerControls
                phoneNumber={prospectData.phone}
                onPhoneNumberChange={phone => handleDataUpdate({ phone })}
                compact={!isDialerExpanded}
              />
            </CardContent>
          </Card>

          {/* Prospect Info Card */}
          <Card className="flex-1 bg-gradient-to-b from-slate-900/95 to-slate-950/95 border-white/10 overflow-hidden">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-cyan-400" />
                <h3 className="text-white font-semibold text-sm">Prospect</h3>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-2 space-y-3 overflow-auto">
              {/* Quick Info */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-slate-800/50 rounded-lg p-2">
                  <span className="text-gray-500 block text-xs">Name</span>
                  <span className="text-white font-medium">
                    {prospectData.firstName
                      ? `${prospectData.firstName} ${prospectData.lastName}`
                      : '-'}
                  </span>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-2">
                  <span className="text-gray-500 block text-xs">Age</span>
                  <span className="text-white font-medium">{prospectData.age || '-'}</span>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-2">
                  <span className="text-gray-500 block text-xs">State</span>
                  <span className="text-white font-medium">{prospectData.state || '-'}</span>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-2">
                  <span className="text-gray-500 block text-xs">Gender</span>
                  <span className="text-white font-medium capitalize">
                    {prospectData.gender || '-'}
                  </span>
                </div>
              </div>

              {/* Selected Quote */}
              {selectedCarrier && (
                <div className="bg-emerald-500/10 rounded-lg p-3 border border-emerald-500/20">
                  <span className="text-gray-400 block text-xs mb-1">Selected</span>
                  <div className="flex items-center justify-between">
                    <span className="text-emerald-400 font-semibold">{selectedCarrier}</span>
                    <span className="text-white font-bold">${prospectData.monthlyPremium}/mo</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Middle/Right - Script and/or Quotes */}
        {activePanel === 'both' ? (
          <>
            {/* Script Panel */}
            <Card className="col-span-5 bg-gradient-to-b from-slate-900/95 to-slate-950/95 border-white/10 overflow-hidden">
              <CardHeader className="p-4 pb-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-white font-semibold text-sm">Script</h3>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-2 h-[calc(100%-60px)] overflow-auto">
                <ScriptPanel prospectData={prospectData} onDataUpdate={handleDataUpdate} />
              </CardContent>
            </Card>

            {/* Quote Panel */}
            <Card className="col-span-4 bg-gradient-to-b from-slate-900/95 to-slate-950/95 border-white/10 overflow-hidden">
              <CardHeader className="p-4 pb-2">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-white font-semibold text-sm">Quotes</h3>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-2 h-[calc(100%-60px)] overflow-auto">
                <QuotePanel
                  prospectData={prospectData}
                  onSelectQuote={handleQuoteSelect}
                  selectedCarrier={selectedCarrier}
                />
              </CardContent>
            </Card>
          </>
        ) : activePanel === 'script' ? (
          <Card className="col-span-8 bg-gradient-to-b from-slate-900/95 to-slate-950/95 border-white/10 overflow-hidden">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-cyan-400" />
                <h3 className="text-white font-semibold text-sm">Script</h3>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-2 h-[calc(100%-60px)] overflow-auto">
              <ScriptPanel prospectData={prospectData} onDataUpdate={handleDataUpdate} />
            </CardContent>
          </Card>
        ) : (
          <Card className="col-span-8 bg-gradient-to-b from-slate-900/95 to-slate-950/95 border-white/10 overflow-hidden">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                <h3 className="text-white font-semibold text-sm">Quotes</h3>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-2 h-[calc(100%-60px)] overflow-auto">
              <QuotePanel
                prospectData={prospectData}
                onSelectQuote={handleQuoteSelect}
                selectedCarrier={selectedCarrier}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default CallCenterPortal;
