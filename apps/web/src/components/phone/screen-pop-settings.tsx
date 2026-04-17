'use client';

import {
 Building2,
 Check,
 FileText,
 GripVertical,
 Mail,
 MapPin,
 Phone,
 RotateCcw,
 Tag,
 User,
 X,
} from 'lucide-react';
import { useCallback, useState, type FC } from 'react';

import { usePhone, type ScreenPopField } from './phone-provider';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ============================================================================
// Screen Pop Settings Modal
// ============================================================================

interface ScreenPopSettingsProps {
 onClose: () => void;
}

// Icon mapping
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
};

// Default fields for reset
const defaultFields: ScreenPopField[] = [
 { id: 'fullName', label: 'Full Name', key: 'fullName', enabled: true, order: 1 },
 { id: 'phoneNumber', label: 'Phone Number', key: 'phoneNumber', enabled: true, order: 2 },
 { id: 'email', label: 'Email', key: 'email', enabled: true, order: 3 },
 { id: 'company', label: 'Company', key: 'company', enabled: true, order: 4 },
 { id: 'address', label: 'Address', key: 'address', enabled: false, order: 5 },
 { id: 'city', label: 'City', key: 'city', enabled: false, order: 6 },
 { id: 'state', label: 'State', key: 'state', enabled: false, order: 7 },
 { id: 'zipCode', label: 'Zip Code', key: 'zipCode', enabled: false, order: 8 },
 { id: 'leadSource', label: 'Lead Source', key: 'leadSource', enabled: true, order: 9 },
 { id: 'campaignName', label: 'Campaign', key: 'campaignName', enabled: true, order: 10 },
 { id: 'notes', label: 'Notes', key: 'notes', enabled: false, order: 11 },
];

export function ScreenPopSettings({ onClose }: ScreenPopSettingsProps): JSX.Element {
 const { screenPopFields, updateScreenPopFields } = usePhone();
 const [localFields, setLocalFields] = useState<ScreenPopField[]>([...screenPopFields]);
 const [draggedId, setDraggedId] = useState<string | null>(null);

 // Toggle field visibility
 const toggleField = useCallback((fieldId: string) => {
 setLocalFields(fields =>
 fields.map(f => (f.id === fieldId ? { ...f, enabled: !f.enabled } : f))
 );
 }, []);

 // Handle drag start
 const handleDragStart = useCallback((fieldId: string) => {
 setDraggedId(fieldId);
 }, []);

 // Handle drag over
 const handleDragOver = useCallback(
 (targetId: string) => {
 if (!draggedId || draggedId === targetId) return;

 setLocalFields(fields => {
 const draggedIndex = fields.findIndex(f => f.id === draggedId);
 const targetIndex = fields.findIndex(f => f.id === targetId);

 if (draggedIndex === -1 || targetIndex === -1) return fields;

 const newFields = [...fields];
 const [draggedField] = newFields.splice(draggedIndex, 1);
 newFields.splice(targetIndex, 0, draggedField);

 // Update order values
 return newFields.map((f, i) => ({ ...f, order: i + 1 }));
 });
 },
 [draggedId]
 );

 // Handle drag end
 const handleDragEnd = useCallback(() => {
 setDraggedId(null);
 }, []);

 // Save changes
 const handleSave = useCallback(() => {
 updateScreenPopFields(localFields);
 onClose();
 }, [localFields, updateScreenPopFields, onClose]);

 // Reset to default
 const handleReset = useCallback(() => {
 setLocalFields([...defaultFields]);
 }, []);

 // Close on backdrop click
 const handleBackdropClick = useCallback(
 (e: React.MouseEvent) => {
 if (e.target === e.currentTarget) {
 onClose();
 }
 },
 [onClose]
 );

 return (
 <div
 className="fixed inset-0 z-50 flex items-center justify-center"
 onClick={handleBackdropClick}
 role="dialog"
 aria-modal="true"
 >
 {/* Backdrop */}
 <div className="absolute inset-0 bg-black/60 " />

 {/* Modal */}
 <div
 className={cn(
 'relative z-10 w-full max-w-lg mx-4',
 'bg-muted',
 'rounded-2xl border border-white/10 shadow-sm',
 'overflow-hidden animate-in fade-in-0 zoom-in-95 duration-200'
 )}
 onClick={e => e.stopPropagation()}
 >
 {/* Header */}
 <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
 <div>
 <h2 className="text-white text-lg font-semibold">Screen Pop Settings</h2>
 <p className="text-gray-500 text-sm mt-0.5">
 Configure which fields appear during incoming calls
 </p>
 </div>
 <Button
 variant="ghost"
 size="icon"
 onClick={onClose}
 className="text-gray-400 hover:text-white"
 >
 <X className="w-5 h-5" />
 </Button>
 </div>

 {/* Content */}
 <div className="px-6 py-4 max-h-[400px] overflow-y-auto">
 <div className="space-y-2">
 {localFields
 .sort((a, b) => a.order - b.order)
 .map(field => {
 const IconComponent = fieldIcons[field.key] ?? FileText;

 return (
 <div
 key={field.id}
 draggable
 onDragStart={() => handleDragStart(field.id)}
 onDragOver={e => {
 e.preventDefault();
 handleDragOver(field.id);
 }}
 onDragEnd={handleDragEnd}
 className={cn(
 'flex items-center gap-3 p-3 rounded-lg',
 'bg-white/5 border border-transparent',
 'hover:bg-white/10 hover:border-white/10',
 'transition-all cursor-move',
 draggedId === field.id && 'opacity-50 scale-95'
 )}
 >
 {/* Drag Handle */}
 <GripVertical className="w-4 h-4 text-gray-600 flex-shrink-0" />

 {/* Icon */}
 <div
 className={cn(
 'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
 field.enabled ? 'bg-cyan-500/10 text-cyan-400' : 'bg-white/5 text-gray-500'
 )}
 >
 <IconComponent className="w-4 h-4" />
 </div>

 {/* Label */}
 <span
 className={cn(
 'flex-1 text-sm',
 field.enabled ? 'text-white' : 'text-gray-500'
 )}
 >
 {field.label}
 </span>

 {/* Toggle */}
 <button
 onClick={() => toggleField(field.id)}
 className={cn(
 'w-10 h-6 rounded-full p-1 transition-colors',
 field.enabled ? 'bg-cyan-500' : 'bg-white/10'
 )}
 >
 <div
 className={cn(
 'w-4 h-4 rounded-full bg-white transition-transform',
 field.enabled ? 'translate-x-4' : 'translate-x-0'
 )}
 />
 </button>
 </div>
 );
 })}
 </div>
 </div>

 {/* Preview */}
 <div className="px-6 py-3 bg-white/5 border-t border-white/10">
 <p className="text-gray-400 text-xs mb-2">Preview:</p>
 <div className="flex flex-wrap gap-2">
 {localFields
 .filter(f => f.enabled)
 .sort((a, b) => a.order - b.order)
 .map(field => (
 <span
 key={field.id}
 className="px-2 py-1 bg-cyan-500/10 text-cyan-400 text-xs rounded-full border border-cyan-500/20"
 >
 {field.label}
 </span>
 ))}
 </div>
 </div>

 {/* Footer */}
 <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between">
 <Button
 variant="ghost"
 onClick={handleReset}
 className="text-gray-400 hover:text-white gap-2"
 >
 <RotateCcw className="w-4 h-4" />
 Reset to Default
 </Button>

 <div className="flex gap-3">
 <Button variant="outline" onClick={onClose} className="border-white/10">
 Cancel
 </Button>
 <Button
 onClick={handleSave}
 className="bg-primary gap-2"
 >
 <Check className="w-4 h-4" />
 Save Changes
 </Button>
 </div>
 </div>
 </div>
 </div>
 );
}

export default ScreenPopSettings;


