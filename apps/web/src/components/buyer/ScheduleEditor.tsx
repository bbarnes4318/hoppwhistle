'use client';

import { Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

interface TimeBlock {
  start: string;
  end: string;
}

export interface HoursOfOperation {
  mon?: TimeBlock[];
  tue?: TimeBlock[];
  wed?: TimeBlock[];
  thu?: TimeBlock[];
  fri?: TimeBlock[];
  sat?: TimeBlock[];
  sun?: TimeBlock[];
}

const DAYS: { key: keyof HoursOfOperation; label: string }[] = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

interface ScheduleEditorProps {
  value: HoursOfOperation | null;
  onChange: (value: HoursOfOperation | null) => void;
  className?: string;
}

export function ScheduleEditor({ value, onChange, className }: ScheduleEditorProps) {
  const [is24x7, setIs24x7] = useState(value === null);

  const handleToggle24x7 = (checked: boolean) => {
    setIs24x7(checked);
    if (checked) {
      // 24/7 mode - null means always open
      onChange(null);
    } else {
      // Initialize with default business hours
      const defaultHours: HoursOfOperation = {
        mon: [{ start: '09:00', end: '17:00' }],
        tue: [{ start: '09:00', end: '17:00' }],
        wed: [{ start: '09:00', end: '17:00' }],
        thu: [{ start: '09:00', end: '17:00' }],
        fri: [{ start: '09:00', end: '17:00' }],
      };
      onChange(defaultHours);
    }
  };

  const addTimeBlock = (day: keyof HoursOfOperation) => {
    const current = value || {};
    const dayBlocks = current[day] || [];
    const newBlocks = [...dayBlocks, { start: '09:00', end: '17:00' }];
    onChange({ ...current, [day]: newBlocks });
  };

  const removeTimeBlock = (day: keyof HoursOfOperation, index: number) => {
    const current = value || {};
    const dayBlocks = current[day] || [];
    const newBlocks = dayBlocks.filter((_, i) => i !== index);
    if (newBlocks.length === 0) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [day]: _, ...rest } = current;
      onChange(Object.keys(rest).length === 0 ? {} : rest);
    } else {
      onChange({ ...current, [day]: newBlocks });
    }
  };

  const updateTimeBlock = (
    day: keyof HoursOfOperation,
    index: number,
    field: 'start' | 'end',
    time: string
  ) => {
    const current = value || {};
    const dayBlocks = current[day] || [];
    const newBlocks = dayBlocks.map((block, i) =>
      i === index ? { ...block, [field]: time } : block
    );
    onChange({ ...current, [day]: newBlocks });
  };

  const toggleDayOpen = (day: keyof HoursOfOperation, open: boolean) => {
    const current = value || {};
    if (open) {
      onChange({ ...current, [day]: [{ start: '09:00', end: '17:00' }] });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [day]: _, ...rest } = current;
      onChange(Object.keys(rest).length === 0 ? {} : rest);
    }
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* 24/7 Toggle */}
      <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/30">
        <div className="space-y-0.5">
          <Label className="text-base">24/7 Availability</Label>
          <p className="text-sm text-muted-foreground">Accept calls at any time, any day</p>
        </div>
        <Switch checked={is24x7} onCheckedChange={handleToggle24x7} />
      </div>

      {/* Schedule Grid */}
      {!is24x7 && (
        <div className="space-y-3">
          {DAYS.map(({ key, label }) => {
            const dayBlocks = value?.[key] || [];
            const isOpen = dayBlocks.length > 0;

            return (
              <div key={key} className="rounded-lg border overflow-hidden">
                {/* Day Header */}
                <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={isOpen}
                      onCheckedChange={checked => toggleDayOpen(key, checked)}
                    />
                    <span className={cn('font-medium', !isOpen && 'text-muted-foreground')}>
                      {label}
                    </span>
                    {!isOpen && (
                      <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                        Closed
                      </span>
                    )}
                  </div>
                  {isOpen && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => addTimeBlock(key)}
                      className="h-8 gap-1 text-xs"
                    >
                      <Plus className="h-3 w-3" />
                      Add Shift
                    </Button>
                  )}
                </div>

                {/* Time Blocks */}
                {isOpen && (
                  <div className="p-4 space-y-2">
                    {dayBlocks.map((block, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Input
                          type="time"
                          value={block.start}
                          onChange={e => updateTimeBlock(key, index, 'start', e.target.value)}
                          className="w-32"
                        />
                        <span className="text-muted-foreground">to</span>
                        <Input
                          type="time"
                          value={block.end}
                          onChange={e => updateTimeBlock(key, index, 'end', e.target.value)}
                          className="w-32"
                        />
                        {dayBlocks.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeTimeBlock(key, index)}
                            className="h-8 w-8 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
