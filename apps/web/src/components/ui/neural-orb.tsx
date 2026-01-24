'use client';

/**
 * Project Cortex | Neural Orb Component
 *
 * The signature "Active Call Indicator" for Hopwhistle.
 * Replaces legacy call status with pulsing, glowing orb.
 *
 * States:
 * - dormant: No active call (dim)
 * - awakening: Incoming/outgoing call (breathing animation)
 * - pulsing: Call connected (steady pulse)
 * - vectoring: On hold (slow rotation)
 */

import { motion, AnimatePresence, type Variants } from 'framer-motion';

import { useCallState } from '@/hooks/adapters';
import { cn } from '@/lib/utils';

export type OrbState = 'dormant' | 'awakening' | 'pulsing' | 'vectoring';

interface NeuralOrbProps {
  /** Override automatic state detection */
  state?: OrbState;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Show call duration inside orb */
  showDuration?: boolean;
  /** Additional class names */
  className?: string;
  /** Click handler */
  onClick?: () => void;
}

const sizeClasses = {
  sm: 'w-8 h-8',
  md: 'w-12 h-12',
  lg: 'w-16 h-16',
  xl: 'w-24 h-24',
};

const glowIntensity = {
  dormant: 'rgba(74, 85, 104, 0.3)',
  awakening: 'rgba(0, 229, 255, 0.5)',
  pulsing: 'rgba(0, 229, 255, 0.8)',
  vectoring: 'rgba(156, 74, 255, 0.6)',
};

const coreColor = {
  dormant: '#4A5568',
  awakening: '#00E5FF',
  pulsing: '#00E5FF',
  vectoring: '#9C4AFF',
};

const orbVariants: Variants = {
  dormant: {
    scale: 1,
    boxShadow: `0 0 10px ${glowIntensity.dormant}`,
  },
  awakening: {
    scale: [1, 1.1, 1],
    boxShadow: [
      `0 0 20px ${glowIntensity.awakening}`,
      `0 0 40px ${glowIntensity.awakening}`,
      `0 0 20px ${glowIntensity.awakening}`,
    ],
    transition: {
      duration: 1.5,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
  pulsing: {
    scale: [1, 1.05, 1],
    boxShadow: [
      `0 0 30px ${glowIntensity.pulsing}`,
      `0 0 50px ${glowIntensity.pulsing}`,
      `0 0 30px ${glowIntensity.pulsing}`,
    ],
    transition: {
      duration: 2,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
  vectoring: {
    scale: 1,
    rotate: [0, 360],
    boxShadow: `0 0 25px ${glowIntensity.vectoring}`,
    transition: {
      rotate: {
        duration: 4,
        repeat: Infinity,
        ease: 'linear',
      },
    },
  },
};

const innerRingVariants: Variants = {
  dormant: { opacity: 0.3, scale: 0.8 },
  awakening: {
    opacity: [0.5, 1, 0.5],
    scale: [0.8, 1.2, 0.8],
    transition: { duration: 1.5, repeat: Infinity },
  },
  pulsing: {
    opacity: [0.7, 1, 0.7],
    scale: [0.9, 1.1, 0.9],
    transition: { duration: 2, repeat: Infinity },
  },
  vectoring: {
    opacity: 0.8,
    scale: 1,
    rotate: [0, -360],
    transition: { rotate: { duration: 3, repeat: Infinity, ease: 'linear' } },
  },
};

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Neural Orb - Active Call Indicator
 *
 * Automatically detects call state or can be manually controlled.
 */
export function NeuralOrb({
  state: overrideState,
  size = 'md',
  showDuration = false,
  className,
  onClick,
}: NeuralOrbProps) {
  const { isActive, state: callState, isOnHold, duration } = useCallState();

  // Determine orb state from call state if not overridden
  const orbState: OrbState =
    overrideState ??
    (isOnHold
      ? 'vectoring'
      : callState === 'connected'
        ? 'pulsing'
        : callState === 'ringing'
          ? 'awakening'
          : isActive
            ? 'pulsing'
            : 'dormant');

  return (
    <motion.div
      className={cn(
        'relative flex items-center justify-center rounded-full cursor-pointer',
        'bg-gradient-to-br from-surface-panel to-surface-dark',
        sizeClasses[size],
        className
      )}
      variants={orbVariants}
      animate={orbState}
      initial="dormant"
      onClick={onClick}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
    >
      {/* Inner Ring */}
      <motion.div
        className={cn('absolute inset-1 rounded-full border-2', 'border-current opacity-50')}
        style={{ borderColor: coreColor[orbState] }}
        variants={innerRingVariants}
        animate={orbState}
      />

      {/* Core */}
      <motion.div
        className={cn(
          'absolute rounded-full',
          size === 'sm'
            ? 'w-3 h-3'
            : size === 'md'
              ? 'w-5 h-5'
              : size === 'lg'
                ? 'w-7 h-7'
                : 'w-10 h-10'
        )}
        style={{ backgroundColor: coreColor[orbState] }}
        animate={{
          opacity: orbState === 'dormant' ? 0.5 : 1,
        }}
      />

      {/* Duration Display (for larger sizes) */}
      <AnimatePresence>
        {showDuration && orbState !== 'dormant' && (size === 'lg' || size === 'xl') && (
          <motion.span
            className="absolute -bottom-6 font-mono text-xs text-brand-cyan"
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
          >
            {formatDuration(duration)}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * NeuralOrbStatic - Non-animated version for SSR or reduced motion
 */
export function NeuralOrbStatic({
  state = 'dormant',
  size = 'md',
  className,
}: Pick<NeuralOrbProps, 'state' | 'size' | 'className'>) {
  return (
    <div
      className={cn(
        'relative flex items-center justify-center rounded-full',
        'bg-gradient-to-br from-surface-panel to-surface-dark',
        sizeClasses[size],
        state !== 'dormant' && 'glow-cyan',
        className
      )}
    >
      <div
        className={cn(
          'absolute rounded-full',
          size === 'sm'
            ? 'w-3 h-3'
            : size === 'md'
              ? 'w-5 h-5'
              : size === 'lg'
                ? 'w-7 h-7'
                : 'w-10 h-10'
        )}
        style={{ backgroundColor: coreColor[state] }}
      />
    </div>
  );
}

export default NeuralOrb;
