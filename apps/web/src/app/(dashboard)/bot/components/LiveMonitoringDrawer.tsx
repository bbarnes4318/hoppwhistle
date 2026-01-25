'use client';

import { ChevronDown, ChevronUp, PhoneCall, CheckCircle, Clock, TrendingUp } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface LiveMonitoringDrawerProps {
  isVisible: boolean;
  activeCalls: number;
  completedCalls: number;
  remainingCalls: number;
  successRate: number;
  concurrency: number;
}

export function LiveMonitoringDrawer({
  isVisible,
  activeCalls,
  completedCalls,
  remainingCalls,
  successRate,
  concurrency,
}: LiveMonitoringDrawerProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-background border-t shadow-lg">
      {/* Collapsed State */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-6 py-3 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="font-medium">Live Monitoring</span>
          </div>
          {!isExpanded && (
            <span className="text-sm text-muted-foreground">
              {activeCalls} active • {completedCalls} completed
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronDown className="h-5 w-5 text-muted-foreground" />
        ) : (
          <ChevronUp className="h-5 w-5 text-muted-foreground" />
        )}
      </button>

      {/* Expanded State */}
      {isExpanded && (
        <div className="px-6 pb-4">
          {activeCalls === 0 && completedCalls === 0 ? (
            <div className="flex items-center justify-center gap-3 py-6 text-muted-foreground">
              <PhoneCall className="h-5 w-5" />
              <span>Calls will appear here once your campaign starts.</span>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-4">
              {/* Active Calls */}
              <Card className="border-l-4 border-l-neon-cyan">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Active Calls</p>
                      <p className="text-2xl font-bold">{activeCalls}</p>
                      <p className="text-xs text-muted-foreground">of {concurrency} max</p>
                    </div>
                    <PhoneCall className="h-8 w-8 text-neon-cyan opacity-50" />
                  </div>
                </CardContent>
              </Card>

              {/* Completed */}
              <Card className="border-l-4 border-l-green-500">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Completed</p>
                      <p className="text-2xl font-bold">{completedCalls}</p>
                      <p className="text-xs text-muted-foreground">calls finished</p>
                    </div>
                    <CheckCircle className="h-8 w-8 text-green-500 opacity-50" />
                  </div>
                </CardContent>
              </Card>

              {/* Remaining */}
              <Card className="border-l-4 border-l-amber-500">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Remaining</p>
                      <p className="text-2xl font-bold">{remainingCalls}</p>
                      <p className="text-xs text-muted-foreground">leads queued</p>
                    </div>
                    <Clock className="h-8 w-8 text-amber-500 opacity-50" />
                  </div>
                </CardContent>
              </Card>

              {/* Success Rate */}
              <Card className="border-l-4 border-l-neon-violet">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Success Rate</p>
                      <p className="text-2xl font-bold">{successRate}%</p>
                      <p className="text-xs text-muted-foreground">transferred</p>
                    </div>
                    <TrendingUp className="h-8 w-8 text-neon-violet opacity-50" />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
