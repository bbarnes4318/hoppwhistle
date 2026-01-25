'use client';

/**
 * Project Cortex | Circuit Connector
 *
 * SVG glow lines connecting the three columns.
 * Glows Electric Cyan when circuit is valid.
 */

import { cn } from '@/lib/utils';

interface CircuitConnectorProps {
  isValid: boolean;
  className?: string;
}

export function CircuitConnector({ isValid, className }: CircuitConnectorProps) {
  const lineColor = isValid ? '#00E5FF' : '#2D3748';
  const glowOpacity = isValid ? 1 : 0;

  return (
    <svg
      className={cn('absolute inset-0 pointer-events-none z-10', className)}
      style={{ width: '100%', height: '100%' }}
    >
      <defs>
        {/* Glow filter */}
        <filter id="circuit-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Animated dash */}
        <linearGradient id="flow-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#00E5FF" stopOpacity="0" />
          <stop offset="50%" stopColor="#00E5FF" stopOpacity="1" />
          <stop offset="100%" stopColor="#00E5FF" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Column 1 → Column 2 connector */}
      <g opacity={glowOpacity} filter="url(#circuit-glow)">
        <line
          x1="33.33%"
          y1="50%"
          x2="33.33%"
          y2="50%"
          stroke={lineColor}
          strokeWidth="2"
          markerEnd="url(#arrow)"
        >
          <animate attributeName="x2" from="33.33%" to="36%" dur="0.5s" fill="freeze" />
        </line>
      </g>

      {/* Column 2 → Column 3 connector */}
      <g opacity={glowOpacity} filter="url(#circuit-glow)">
        <line x1="66.66%" y1="50%" x2="66.66%" y2="50%" stroke={lineColor} strokeWidth="2">
          <animate attributeName="x2" from="66.66%" to="69%" dur="0.5s" fill="freeze" />
        </line>
      </g>

      {/* Flow indicators (animated circles) */}
      {isValid && (
        <>
          {/* Flow 1→2 */}
          <circle r="4" fill="#00E5FF" filter="url(#circuit-glow)">
            <animateMotion dur="2s" repeatCount="indefinite" path="M 140 200 L 180 200" />
          </circle>

          {/* Flow 2→3 */}
          <circle r="4" fill="#00E5FF" filter="url(#circuit-glow)">
            <animateMotion dur="2s" repeatCount="indefinite" path="M 340 200 L 380 200" />
          </circle>
        </>
      )}
    </svg>
  );
}

/**
 * Simplified connector bars between columns
 */
export function ColumnConnector({ isValid }: { isValid: boolean }) {
  return (
    <div className="flex items-center justify-center w-6 shrink-0">
      <div className="relative h-48 w-1">
        {/* Base line */}
        <div
          className={cn(
            'absolute inset-0 rounded-full transition-all duration-500',
            isValid ? 'bg-neon-cyan shadow-[0_0_10px_rgba(0,229,255,0.5)]' : 'bg-panel'
          )}
        />

        {/* Flow animation */}
        {isValid && (
          <div className="absolute w-full h-8 rounded-full bg-gradient-to-b from-transparent via-white to-transparent animate-flow" />
        )}

        {/* Arrow indicator */}
        <div
          className={cn(
            'absolute -right-1.5 top-1/2 -translate-y-1/2',
            'border-t-4 border-b-4 border-l-6 border-transparent',
            isValid ? 'border-l-neon-cyan' : 'border-l-panel'
          )}
          style={{
            borderLeftWidth: '6px',
            borderLeftStyle: 'solid',
            borderLeftColor: isValid ? '#00E5FF' : '#1E2530',
          }}
        />
      </div>
    </div>
  );
}

export default CircuitConnector;
