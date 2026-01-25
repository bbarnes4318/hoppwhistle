'use client';

/**
 * Project Cortex | Neural Orb AI Visualizer
 *
 * GPU-accelerated animations using transform/opacity only.
 * Zero main-thread blocking.
 *
 * Visual States:
 * - idle: Breathing ring of Hyper-Violet (#9C4AFF), 12bpm pulse
 * - listening: Electric Cyan waveform (#00E5FF) reacting to amplitude
 * - processing: Rapidly spinning Iridescent sphere (Cyan + Magenta)
 * - speaking: Outward pulsing Toxic Lime (#CCFF00)
 */

import { motion, type Variants } from 'framer-motion';
import { useCallState } from '@/hooks/adapters';
import { cn } from '@/lib/utils';

export type OrbState = 'idle' | 'listening' | 'processing' | 'speaking';

interface NeuralOrbProps {
  /** Override automatic state detection */
  state?: OrbState;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Mock amplitude for listening state (0-1) */
  amplitude?: number;
  /** Show call duration */
  showDuration?: boolean;
  /** Additional class names */
  className?: string;
  /** Click handler */
  onClick?: () => void;
}

const sizeMap = {
  sm: { orb: 32, ring: 40, glow: 48 },
  md: { orb: 48, ring: 60, glow: 72 },
  lg: { orb: 64, ring: 80, glow: 96 },
  xl: { orb: 96, ring: 120, glow: 144 },
};

// Color palette
const colors = {
  idle: '#9C4AFF', // Hyper-Violet
  listening: '#00E5FF', // Electric Cyan
  processing: {
    cyan: '#00E5FF',
    magenta: '#FF00FF',
  },
  speaking: '#CCFF00', // Toxic Lime
};

// 12 BPM = 5 second cycle for idle breathing
const BREATHING_DURATION = 5;

// GPU-accelerated variants (transform & opacity only)
const orbVariants: Variants = {
  idle: {
    scale: [1, 1.08, 1],
    opacity: [0.8, 1, 0.8],
    transition: {
      duration: BREATHING_DURATION,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
  listening: {
    scale: [1, 1.15, 1.05, 1.2, 1],
    opacity: 1,
    transition: {
      duration: 0.8,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
  processing: {
    scale: 1,
    opacity: 1,
    rotate: 360,
    transition: {
      rotate: {
        duration: 0.8,
        repeat: Infinity,
        ease: 'linear',
      },
    },
  },
  speaking: {
    scale: [1, 1.25, 1],
    opacity: [1, 0.7, 1],
    transition: {
      duration: 0.4,
      repeat: Infinity,
      ease: 'easeOut',
    },
  },
};

const ringVariants: Variants = {
  idle: {
    scale: [1, 1.1, 1],
    opacity: [0.4, 0.7, 0.4],
    transition: {
      duration: BREATHING_DURATION,
      repeat: Infinity,
      ease: 'easeInOut',
      delay: 0.2,
    },
  },
  listening: {
    scale: [1, 1.3, 1.1, 1.4, 1],
    opacity: [0.5, 0.9, 0.6, 1, 0.5],
    transition: {
      duration: 0.6,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
  processing: {
    scale: 1.1,
    opacity: 0.8,
    rotate: -360,
    transition: {
      rotate: {
        duration: 1.2,
        repeat: Infinity,
        ease: 'linear',
      },
    },
  },
  speaking: {
    scale: [1, 1.5, 1.8],
    opacity: [0.8, 0.4, 0],
    transition: {
      duration: 0.6,
      repeat: Infinity,
      ease: 'easeOut',
    },
  },
};

const glowVariants: Variants = {
  idle: {
    scale: [1, 1.15, 1],
    opacity: [0.2, 0.4, 0.2],
    transition: {
      duration: BREATHING_DURATION,
      repeat: Infinity,
      ease: 'easeInOut',
      delay: 0.4,
    },
  },
  listening: {
    scale: [1, 1.5, 1.2, 1.6, 1],
    opacity: [0.3, 0.6, 0.4, 0.7, 0.3],
    transition: {
      duration: 0.5,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
  processing: {
    scale: [1.2, 1.4, 1.2],
    opacity: [0.5, 0.8, 0.5],
    transition: {
      duration: 0.4,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
  speaking: {
    scale: [1, 2, 2.5],
    opacity: [0.6, 0.3, 0],
    transition: {
      duration: 0.5,
      repeat: Infinity,
      ease: 'easeOut',
    },
  },
};

function getOrbColor(state: OrbState): string {
  switch (state) {
    case 'idle':
      return colors.idle;
    case 'listening':
      return colors.listening;
    case 'processing':
      return `conic-gradient(from 0deg, ${colors.processing.cyan}, ${colors.processing.magenta}, ${colors.processing.cyan})`;
    case 'speaking':
      return colors.speaking;
  }
}

function getRingColor(state: OrbState): string {
  switch (state) {
    case 'idle':
      return colors.idle;
    case 'listening':
      return colors.listening;
    case 'processing':
      return colors.processing.magenta;
    case 'speaking':
      return colors.speaking;
  }
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Neural Orb AI Visualizer
 *
 * GPU-accelerated component for real-time AI state visualization.
 * Uses only transform and opacity for 60fps performance.
 */
export function NeuralOrb({
  state: overrideState,
  size = 'md',
  amplitude = 0.5,
  showDuration = false,
  className,
  onClick,
}: NeuralOrbProps) {
  const { isActive, state: callState, isOnHold, duration } = useCallState();

  // Auto-detect state from call state if not overridden
  const orbState: OrbState =
    overrideState ??
    (isOnHold
      ? 'processing'
      : callState === 'connected'
        ? 'speaking'
        : callState === 'ringing'
          ? 'listening'
          : isActive
            ? 'processing'
            : 'idle');

  const dimensions = sizeMap[size];
  const orbColor = getOrbColor(orbState);
  const ringColor = getRingColor(orbState);

  // Dynamic scale based on amplitude for listening state
  const amplitudeScale = orbState === 'listening' ? 1 + amplitude * 0.3 : 1;

  return (
    <div
      className={cn(
        'relative flex items-center justify-center cursor-pointer',
        'will-change-transform', // GPU hint
        className
      )}
      style={{
        width: dimensions.glow,
        height: dimensions.glow,
      }}
      onClick={onClick}
    >
      {/* Outer Glow Layer */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: dimensions.glow,
          height: dimensions.glow,
          background:
            orbState === 'processing'
              ? `radial-gradient(circle, ${colors.processing.cyan}40, ${colors.processing.magenta}20, transparent 70%)`
              : `radial-gradient(circle, ${ringColor}40, transparent 70%)`,
          willChange: 'transform, opacity',
        }}
        variants={glowVariants}
        animate={orbState}
        initial="idle"
      />

      {/* Ring Layer */}
      <motion.div
        className="absolute rounded-full border-2"
        style={{
          width: dimensions.ring,
          height: dimensions.ring,
          borderColor: ringColor,
          willChange: 'transform, opacity',
        }}
        variants={ringVariants}
        animate={orbState}
        initial="idle"
      />

      {/* Core Orb */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: dimensions.orb,
          height: dimensions.orb,
          background: orbColor,
          willChange: 'transform, opacity',
          transform: `scale(${amplitudeScale})`,
        }}
        variants={orbVariants}
        animate={orbState}
        initial="idle"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
      />

      {/* Inner Highlight (for depth) */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: dimensions.orb * 0.5,
          height: dimensions.orb * 0.5,
          background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.4), transparent 60%)',
          willChange: 'opacity',
        }}
        animate={{
          opacity: orbState === 'idle' ? [0.3, 0.5, 0.3] : 0.4,
        }}
        transition={{
          duration: BREATHING_DURATION,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Duration Display */}
      {showDuration && orbState !== 'idle' && (size === 'lg' || size === 'xl') && (
        <motion.span
          className="absolute -bottom-6 font-mono text-xs"
          style={{ color: ringColor }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {formatDuration(duration)}
        </motion.span>
      )}
    </div>
  );
}

/**
 * NeuralOrbMini - Compact version for inline use
 */
export function NeuralOrbMini({
  state = 'idle',
  className,
}: {
  state?: OrbState;
  className?: string;
}) {
  return (
    <motion.div
      className={cn('w-3 h-3 rounded-full', className)}
      style={{
        background: getOrbColor(state),
        willChange: 'transform, opacity',
      }}
      animate={
        state === 'idle'
          ? { scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }
          : state === 'processing'
            ? { rotate: 360 }
            : { scale: [1, 1.2, 1] }
      }
      transition={{
        duration: state === 'processing' ? 0.8 : 2,
        repeat: Infinity,
        ease: state === 'processing' ? 'linear' : 'easeInOut',
      }}
    />
  );
}

/**
 * LiveCallOrb - Pulses Toxic Lime when there are active calls
 * Used in the header to indicate system activity
 */
export function LiveCallOrb({
  activeCalls = 0,
  className,
}: {
  activeCalls?: number;
  className?: string;
}) {
  const isActive = activeCalls > 0;

  return (
    <div className={cn('relative flex items-center justify-center', 'w-10 h-10', className)}>
      {/* Outer glow ring */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 40,
          height: 40,
          background: isActive
            ? 'radial-gradient(circle, rgba(204,255,0,0.3), transparent 70%)'
            : 'radial-gradient(circle, rgba(156,74,255,0.2), transparent 70%)',
          willChange: 'transform, opacity',
        }}
        animate={{
          scale: isActive ? [1, 1.3, 1] : [1, 1.1, 1],
          opacity: isActive ? [0.5, 0.8, 0.5] : [0.3, 0.5, 0.3],
        }}
        transition={{
          duration: isActive ? 1.5 : 3,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Ring */}
      <motion.div
        className="absolute rounded-full border-2"
        style={{
          width: 28,
          height: 28,
          borderColor: isActive ? '#CCFF00' : '#9C4AFF',
          willChange: 'transform, opacity',
        }}
        animate={{
          scale: isActive ? [1, 1.15, 1] : [1, 1.05, 1],
          opacity: isActive ? [0.6, 1, 0.6] : [0.4, 0.6, 0.4],
        }}
        transition={{
          duration: isActive ? 1.5 : 3,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: 0.1,
        }}
      />

      {/* Core orb */}
      <motion.div
        className="absolute rounded-full flex items-center justify-center"
        style={{
          width: 20,
          height: 20,
          background: isActive ? '#CCFF00' : '#9C4AFF',
          willChange: 'transform, opacity',
        }}
        animate={{
          scale: isActive ? [1, 1.1, 1] : [1, 1.05, 1],
        }}
        transition={{
          duration: isActive ? 1 : 2,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      >
        {/* Call count */}
        {isActive && (
          <span className="font-mono text-[10px] font-bold text-void">
            {activeCalls > 99 ? '99+' : activeCalls}
          </span>
        )}
      </motion.div>
    </div>
  );
}

export default NeuralOrb;
