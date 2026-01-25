'use client';

/**
 * Project Cortex | Target Edit Modal
 *
 * Glass modal for editing target configuration.
 */

import { useState } from 'react';
import { X, Save, Phone } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NodeLabel, NodeField } from '@/components/ui/node-label';
import { DaySelector } from './DaypartingIndicator';
import type { Target } from '@/types/target';

interface TargetEditModalProps {
  target: Target | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (target: Target) => void;
}

export function TargetEditModal({ target, isOpen, onClose, onSave }: TargetEditModalProps) {
  const [formData, setFormData] = useState<Partial<Target>>(target || {});

  // Update form when target changes
  useState(() => {
    if (target) {
      setFormData(target);
    }
  });

  const handleSave = () => {
    if (target && formData) {
      onSave({ ...target, ...formData } as Target);
    }
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && target && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-void/80 backdrop-blur-sm"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div
              className={cn(
                'w-full max-w-xl rounded-2xl',
                'bg-panel/90 backdrop-blur-xl',
                'border border-white/10',
                'shadow-[0_0_40px_rgba(0,229,255,0.1)]'
              )}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-white/5">
                <div>
                  <h2 className="font-display text-lg font-bold text-text-primary uppercase tracking-wider">
                    CONFIGURE TARGET
                  </h2>
                  <p className="font-mono text-xs text-neon-cyan">
                    {target.buyerName} / {target.targetName}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="h-8 w-8 text-text-muted hover:text-text-primary"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Content */}
              <div className="p-6 space-y-6">
                {/* Target Name */}
                <NodeField label="TARGET NAME" hint="Internal reference name">
                  <Input
                    value={formData.targetName || ''}
                    onChange={e => setFormData({ ...formData, targetName: e.target.value })}
                    className="bg-void border-white/10 font-mono"
                  />
                </NodeField>

                {/* Destination Number */}
                <NodeField label="DESTINATION (SIP/PSTN)" hint="Where calls are routed">
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neon-cyan" />
                    <Input
                      value={formData.destinationNumber || ''}
                      onChange={e =>
                        setFormData({ ...formData, destinationNumber: e.target.value })
                      }
                      placeholder="+1 (800) 555-1234"
                      className="pl-10 bg-void border-white/10 font-mono text-neon-cyan"
                    />
                  </div>
                </NodeField>

                {/* Caps Grid */}
                <div className="grid grid-cols-2 gap-4">
                  <NodeField label="CONCURRENCY CAP" hint="Max simultaneous calls">
                    <Input
                      type="number"
                      value={formData.concurrencyCap || 0}
                      onChange={e =>
                        setFormData({ ...formData, concurrencyCap: parseInt(e.target.value) || 0 })
                      }
                      className="bg-void border-white/10 font-mono"
                    />
                  </NodeField>

                  <NodeField label="DAILY CAP" hint="Max conversions per day">
                    <Input
                      type="number"
                      value={formData.dailyCap || 0}
                      onChange={e =>
                        setFormData({ ...formData, dailyCap: parseInt(e.target.value) || 0 })
                      }
                      className="bg-void border-white/10 font-mono"
                    />
                  </NodeField>
                </div>

                {/* Hours of Operation */}
                <div className="space-y-3">
                  <NodeLabel>HOURS OF OPERATION</NodeLabel>

                  {/* Day Selector */}
                  <DaySelector
                    selected={formData.hoursOfOperation?.daysOfWeek || [1, 2, 3, 4, 5]}
                    onChange={days =>
                      setFormData({
                        ...formData,
                        hoursOfOperation: {
                          ...formData.hoursOfOperation!,
                          daysOfWeek: days,
                        },
                      })
                    }
                  />

                  {/* Time Range */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <span className="font-mono text-[10px] text-text-muted uppercase">START</span>
                      <Input
                        type="time"
                        value={formData.hoursOfOperation?.startTime || '08:00'}
                        onChange={e =>
                          setFormData({
                            ...formData,
                            hoursOfOperation: {
                              ...formData.hoursOfOperation!,
                              startTime: e.target.value,
                            },
                          })
                        }
                        className="bg-void border-white/10 font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="font-mono text-[10px] text-text-muted uppercase">END</span>
                      <Input
                        type="time"
                        value={formData.hoursOfOperation?.endTime || '20:00'}
                        onChange={e =>
                          setFormData({
                            ...formData,
                            hoursOfOperation: {
                              ...formData.hoursOfOperation!,
                              endTime: e.target.value,
                            },
                          })
                        }
                        className="bg-void border-white/10 font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Timezone */}
                <NodeField label="TIMEZONE">
                  <select
                    value={formData.timezone || 'America/New_York'}
                    onChange={e => setFormData({ ...formData, timezone: e.target.value })}
                    className={cn(
                      'w-full h-10 px-3 rounded-lg',
                      'bg-void border border-white/10',
                      'font-mono text-sm text-text-primary',
                      'focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30'
                    )}
                  >
                    <option value="America/New_York">Eastern (EST/EDT)</option>
                    <option value="America/Chicago">Central (CST/CDT)</option>
                    <option value="America/Denver">Mountain (MST/MDT)</option>
                    <option value="America/Los_Angeles">Pacific (PST/PDT)</option>
                  </select>
                </NodeField>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-3 p-4 border-t border-white/5">
                <Button
                  variant="ghost"
                  onClick={onClose}
                  className="font-mono text-xs text-text-muted hover:text-text-primary"
                >
                  CANCEL
                </Button>
                <Button
                  onClick={handleSave}
                  className={cn(
                    'gap-2 font-mono text-xs',
                    'bg-neon-cyan text-void hover:bg-neon-cyan/90',
                    'shadow-[0_0_15px_rgba(0,229,255,0.3)]'
                  )}
                >
                  <Save className="h-3 w-3" />
                  SAVE TARGET
                </Button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default TargetEditModal;
