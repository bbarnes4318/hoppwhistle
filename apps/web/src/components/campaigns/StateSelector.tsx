'use client';

import { Check, ChevronsUpDown, Globe, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// US States list
const US_STATES = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
  // Territories (optional)
  { code: 'DC', name: 'District of Columbia' },
  { code: 'PR', name: 'Puerto Rico' },
];

interface StateSelectorProps {
  value: string[];
  onChange: (value: string[]) => void;
  className?: string;
}

export function StateSelector({ value, onChange, className }: StateSelectorProps) {
  const [open, setOpen] = useState(false);

  const isNational = value.length === 0;

  const selectedStatesMap = useMemo(() => {
    return new Set(value);
  }, [value]);

  const toggleState = (code: string) => {
    if (selectedStatesMap.has(code)) {
      onChange(value.filter(s => s !== code));
    } else {
      onChange([...value, code].sort());
    }
  };

  const selectAll = () => {
    onChange(US_STATES.map(s => s.code));
  };

  const clearAll = () => {
    onChange([]);
  };

  const removeState = (code: string) => {
    onChange(value.filter(s => s !== code));
  };

  return (
    <div className={cn('space-y-2', className)}>
      {/* Trigger Button */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
          >
            <span className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              {isNational ? (
                <span className="text-muted-foreground">National (All States)</span>
              ) : (
                <span>{value.length} states selected</span>
              )}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search states..." />
            <CommandEmpty>No state found.</CommandEmpty>
            <div className="flex items-center justify-between gap-2 border-b p-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={selectAll}
                className="h-8 text-xs"
              >
                Select All
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="h-8 text-xs"
              >
                Clear (National)
              </Button>
            </div>
            <CommandGroup className="max-h-[300px] overflow-y-auto">
              {US_STATES.map(state => (
                <CommandItem
                  key={state.code}
                  value={state.name}
                  onSelect={() => toggleState(state.code)}
                  className="cursor-pointer"
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      selectedStatesMap.has(state.code) ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="font-mono text-xs mr-2 w-6">{state.code}</span>
                  {state.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Selected States Badges */}
      {!isNational && value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.slice(0, 10).map(code => {
            const state = US_STATES.find(s => s.code === code);
            return (
              <Badge key={code} variant="secondary" className="gap-1 pr-1">
                {code}
                <button
                  type="button"
                  onClick={() => removeState(code)}
                  className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
          {value.length > 10 && <Badge variant="outline">+{value.length - 10} more</Badge>}
        </div>
      )}

      {/* National Indicator */}
      {isNational && (
        <p className="text-xs text-muted-foreground">
          <Globe className="inline h-3 w-3 mr-1" />
          Accepting calls from all US states
        </p>
      )}
    </div>
  );
}
