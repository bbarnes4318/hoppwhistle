import * as React from 'react';

import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/domain';
import { cn } from '@/lib/utils';

/**
 * Per-panel skeletons.
 *
 * Each one is the shape of the panel it stands in for — same header, same row
 * height, same number of columns — so the page does not reflow when the data
 * lands. A single page-wide spinner would hide five panels behind the slowest
 * one; these let the fast panels paint immediately.
 */

function Shimmer({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      aria-hidden
      style={style}
      className={cn('animate-pulse rounded-control bg-sunken', className)}
    />
  );
}

export function StatTileRowSkeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading figures"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      {Array.from({ length: tiles }).map((_, i) => (
        <div key={i} className="rounded-card border border-rule bg-surface p-4">
          <Shimmer className="h-3 w-24" />
          <Shimmer className="mt-3 h-6 w-28" />
          <Shimmer className="mt-3 h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({
  title,
  rows = 8,
  columns = 5,
}: {
  title: string;
  rows?: number;
  columns?: number;
}) {
  return (
    <Panel role="status" aria-label={`Loading ${title.toLowerCase()}`}>
      <PanelHeader>
        <PanelTitle>{title}</PanelTitle>
      </PanelHeader>
      <PanelBody flush>
        <div className="divide-y divide-rule">
          {Array.from({ length: rows }).map((_, r) => (
            <div key={r} className="flex h-row items-center gap-4 px-4">
              {Array.from({ length: columns }).map((_, c) => (
                <Shimmer key={c} className={cn('h-3', c === 0 ? 'w-1/4' : 'flex-1')} />
              ))}
            </div>
          ))}
        </div>
      </PanelBody>
    </Panel>
  );
}

export function PanelSkeleton({ title, lines = 4 }: { title: string; lines?: number }) {
  return (
    <Panel role="status" aria-label={`Loading ${title.toLowerCase()}`}>
      <PanelHeader>
        <PanelTitle>{title}</PanelTitle>
      </PanelHeader>
      <PanelBody className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <Shimmer key={i} className={cn('h-3', i === 0 ? 'w-2/3' : 'w-full')} />
        ))}
      </PanelBody>
    </Panel>
  );
}

export function ChartSkeleton({ title, height = 180 }: { title: string; height?: number }) {
  return (
    <Panel role="status" aria-label={`Loading ${title.toLowerCase()}`}>
      <PanelHeader>
        <PanelTitle>{title}</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <div className="flex items-end gap-1" style={{ height }}>
          {Array.from({ length: 24 }).map((_, i) => (
            <Shimmer
              key={i}
              className="flex-1 rounded-sm"
              // Static, repeating heights: a random skeleton reads as data.
              style={{ height: `${30 + ((i * 37) % 60)}%` }}
            />
          ))}
        </div>
      </PanelBody>
    </Panel>
  );
}
