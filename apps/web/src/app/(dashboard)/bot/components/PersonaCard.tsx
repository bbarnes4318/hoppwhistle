'use client';

/**
 * Project Cortex | Persona Card Component
 *
 * Voice selector card with glowing avatar ring.
 * Selected state: Electric Cyan glow effect.
 */

import { motion } from 'framer-motion';
import { User, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Voice {
  id: string;
  name: string;
  gender: 'Female' | 'Male';
  accent: string;
}

interface PersonaCardProps {
  voice: Voice;
  selected: boolean;
  onSelect: () => void;
  className?: string;
}

export function PersonaCard({ voice, selected, onSelect, className }: PersonaCardProps) {
  const isFemale = voice.gender === 'Female';

  return (
    <motion.button
      onClick={onSelect}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'relative flex flex-col items-center gap-3 p-4 rounded-xl',
        'bg-panel/60 backdrop-blur-sm',
        'border border-white/5',
        'transition-all duration-300',
        'text-center',
        // Hover state
        'hover:border-neon-cyan/30 hover:bg-neon-cyan/5',
        // Selected state - Electric Cyan glow
        selected && [
          'border-neon-cyan',
          'shadow-[0_0_20px_rgba(0,229,255,0.3)]',
          'bg-neon-cyan/10',
        ],
        className
      )}
    >
      {/* Avatar Ring */}
      <div className="relative">
        {/* Glow ring for selected */}
        {selected && (
          <motion.div
            className={cn(
              'absolute inset-0 rounded-full',
              isFemale ? 'bg-pink-500/20' : 'bg-neon-violet/20'
            )}
            animate={{
              scale: [1, 1.3, 1],
              opacity: [0.5, 0.2, 0.5],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        )}

        {/* Avatar circle */}
        <div
          className={cn(
            'relative flex h-14 w-14 items-center justify-center rounded-full',
            'border-2 transition-all duration-300',
            isFemale
              ? 'bg-pink-500/10 border-pink-500/30 text-pink-400'
              : 'bg-neon-violet/10 border-neon-violet/30 text-neon-violet',
            selected && ['border-neon-cyan', isFemale ? 'bg-pink-500/20' : 'bg-neon-violet/20']
          )}
        >
          <User className="h-6 w-6" />
        </div>

        {/* Selected indicator */}
        {selected && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className={cn(
              'absolute -top-1 -right-1',
              'flex h-5 w-5 items-center justify-center',
              'rounded-full bg-neon-cyan',
              'shadow-[0_0_8px_rgba(0,229,255,0.5)]'
            )}
          >
            <Volume2 className="h-3 w-3 text-void" />
          </motion.div>
        )}
      </div>

      {/* Voice info */}
      <div className="space-y-1">
        <p
          className={cn(
            'font-display font-semibold text-sm uppercase tracking-wide',
            selected ? 'text-neon-cyan' : 'text-text-primary'
          )}
        >
          {voice.name}
        </p>
        <p className="text-xs text-text-muted font-mono">
          {voice.gender} • {voice.accent}
        </p>
      </div>
    </motion.button>
  );
}

/**
 * PersonaCardGrid - Grid container for persona cards
 */
export function PersonaCardGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3', className)}>
      {children}
    </div>
  );
}

export default PersonaCard;
