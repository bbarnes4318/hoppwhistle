'use client';

import {
  Building2,
  Calendar,
  ChevronDown,
  ChevronUp,
  FileText,
  Globe,
  Mail,
  MapPin,
  Phone,
  Tag,
  User,
} from 'lucide-react';
import { useState, type FC } from 'react';

import { cn } from '@/lib/utils';

import { usePhone, type ProspectData, type ScreenPopField } from './phone-provider';


// ============================================================================
// Screen Pop Component
// ============================================================================

interface ScreenPopProps {
  data: ProspectData;
  variant?: 'panel' | 'modal';
  className?: string;
}

// Icon mapping for different field types
const fieldIcons: Record<string, FC<{ className?: string }>> = {
  fullName: User,
  firstName: User,
  lastName: User,
  phoneNumber: Phone,
  email: Mail,
  company: Building2,
  address: MapPin,
  city: MapPin,
  state: MapPin,
  zipCode: MapPin,
  leadSource: Tag,
  campaignName: Tag,
  notes: FileText,
  createdAt: Calendar,
  website: Globe,
};

export function ScreenPop({ data, variant = 'panel', className }: ScreenPopProps): JSX.Element {
  const { screenPopFields } = usePhone();
  const [isExpanded, setIsExpanded] = useState(variant === 'modal');

  // Get enabled fields sorted by order
  const enabledFields = screenPopFields
    .filter(field => field.enabled)
    .sort((a, b) => a.order - b.order);

  // Get field value from data
  const getFieldValue = (key: string): string | null => {
    if (key in data) {
      const value = data[key as keyof ProspectData];
      if (value === null || value === undefined) return null;
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    }
    // Check custom fields
    if (data.customFields && key in data.customFields) {
      return String(data.customFields[key]);
    }
    return null;
  };

  // Build full address if individual fields are present
  const getFullAddress = (): string | null => {
    const parts = [data.address, data.city, data.state, data.zipCode].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  };

  // Render a single field
  const renderField = (field: ScreenPopField): JSX.Element | null => {
    let value = getFieldValue(field.key);

    // Special handling for address fields - combine them
    if (['address', 'city', 'state', 'zipCode'].includes(field.key) && field.key === 'address') {
      value = getFullAddress();
    } else if (['city', 'state', 'zipCode'].includes(field.key)) {
      // Skip individual address parts if address is enabled
      const addressField = enabledFields.find(f => f.key === 'address');
      if (addressField?.enabled) return null;
    }

    if (!value) return null;

    const IconComponent = fieldIcons[field.key] ?? FileText;

    return (
      <div key={field.id} className="flex items-start gap-3 py-2">
        <div
          className={cn(
            'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0',
            'bg-brand-tint'
          )}
        >
          <IconComponent className={cn('w-4 h-4', 'text-brand-ink')} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-ink-3 text-xs mb-0.5">{field.label}</p>
          <p className={cn('text-sm break-words', 'text-ink')}>{value}</p>
        </div>
      </div>
    );
  };

  // Count visible fields
  const visibleFields = enabledFields
    .map(field => ({ field, value: getFieldValue(field.key) }))
    .filter(({ value }) => value !== null);

  if (visibleFields.length === 0) {
    return (
      <div className={cn('p-4 rounded-card text-center', 'bg-sunken', className)}>
        <FileText className="w-8 h-8 mx-auto mb-2 text-ink-3" />
        <p className="text-ink-3 text-sm">No prospect data available</p>
      </div>
    );
  }

  // Determine how many to show when collapsed
  const collapsedCount = variant === 'modal' ? 5 : 3;
  const hasMore = visibleFields.length > collapsedCount;

  return (
    <div className={cn('rounded-card overflow-hidden', 'bg-sunken border border-rule', className)}>
      {/* Header */}
      <div
        className={cn(
          'px-4 py-3 flex items-center justify-between',
          variant === 'modal'
            ? 'bg-primary border-b border-rule'
            : 'bg-surface border-b border-rule'
        )}
      >
        <div className="flex items-center gap-2">
          <User className="w-4 h-4 text-brand-ink" />
          <span className={cn('font-medium text-sm', 'text-ink')}>Prospect Information</span>
        </div>
        <span className="text-xs text-ink-3">
          {visibleFields.length} field{visibleFields.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Fields */}
      <div className="px-4 divide-y divide-rule">
        {enabledFields
          .slice(0, isExpanded ? undefined : collapsedCount)
          .map(field => renderField(field))}
      </div>

      {/* Expand/Collapse Button */}
      {hasMore && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            'w-full px-4 py-2 flex items-center justify-center gap-2',
            'text-xs text-ink-3 hover:text-ink',
            'border-t border-rule hover:bg-rule',
            'transition-colors'
          )}
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-4 h-4" />
              Show Less
            </>
          ) : (
            <>
              <ChevronDown className="w-4 h-4" />
              Show {visibleFields.length - collapsedCount} More
            </>
          )}
        </button>
      )}
    </div>
  );
}

export default ScreenPop;
