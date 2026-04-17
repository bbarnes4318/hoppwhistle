'use client';

import { Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

// Zod schema for type safety
export const pricingRuleSchema = z.object({
 field: z.enum(['age', 'state', 'income', 'custom']),
 op: z.enum(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'in']),
 val: z.union([z.number(), z.string(), z.array(z.string())]),
 adjustment: z.string(), // "+5.00" or "-2.50"
});

export type PricingRule = z.infer<typeof pricingRuleSchema>;

const FIELDS = [
 { value: 'age', label: 'Age' },
 { value: 'state', label: 'State' },
 { value: 'income', label: 'Income' },
 { value: 'custom', label: 'Custom Field' },
];

const OPERATORS = [
 { value: 'eq', label: '=' },
 { value: 'neq', label: '!=' },
 { value: 'gt', label: '>' },
 { value: 'lt', label: '<' },
 { value: 'gte', label: '>=' },
 { value: 'lte', label: '<=' },
 { value: 'in', label: 'in' },
];

interface PricingRulesEditorProps {
 basePrice: number;
 onBasePriceChange: (price: number) => void;
 rules: PricingRule[];
 onRulesChange: (rules: PricingRule[]) => void;
 className?: string;
}

export function PricingRulesEditor({
 basePrice,
 onBasePriceChange,
 rules,
 onRulesChange,
 className,
}: PricingRulesEditorProps) {
 const addRule = () => {
 const newRule: PricingRule = {
 field: 'age',
 op: 'gt',
 val: 65,
 adjustment: '+5.00',
 };
 onRulesChange([...rules, newRule]);
 };

 const removeRule = (index: number) => {
 onRulesChange(rules.filter((_, i) => i !== index));
 };

 const updateRule = (index: number, updates: Partial<PricingRule>) => {
 onRulesChange(rules.map((rule, i) => (i === index ? { ...rule, ...updates } : rule)));
 };

 const formatAdjustment = (value: string): string => {
 // Ensure the value has a +/- prefix
 const cleanValue = value.replace(/[^0-9.-]/g, '');
 const num = parseFloat(cleanValue);
 if (isNaN(num)) return '+0.00';
 const formatted = Math.abs(num).toFixed(2);
 return num >= 0 ? `+${formatted}` : `-${formatted}`;
 };

 return (
 <div className={cn('space-y-4', className)}>
 {/* Base Price */}
 <div className="space-y-2">
 <Label htmlFor="basePrice" className="text-base font-medium">
 Base Bid Price
 </Label>
 <div className="flex items-center gap-2">
 <span className="text-lg font-semibold text-muted-foreground">$</span>
 <Input
 id="basePrice"
 type="number"
 step="0.01"
 min="0"
 value={basePrice}
 onChange={e => onBasePriceChange(parseFloat(e.target.value) || 0)}
 className="w-32"
 />
 <span className="text-sm text-muted-foreground">per qualified call</span>
 </div>
 </div>

 {/* Rules Section */}
 <div className="space-y-3">
 <div className="flex items-center justify-between">
 <Label className="text-base font-medium">Bid Adjustments</Label>
 <Button type="button" variant="outline" size="sm" onClick={addRule} className="gap-1">
 <Plus className="h-4 w-4" />
 Add Rule
 </Button>
 </div>

 {rules.length === 0 ? (
 <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
 <p className="text-sm">No adjustment rules configured.</p>
 <p className="text-xs mt-1">
 Click "Add Rule" to create bid adjustments based on call attributes.
 </p>
 </div>
 ) : (
 <div className="space-y-2">
 {rules.map((rule, index) => (
 <div
 key={index}
 className="flex items-center gap-2 rounded-lg border p-3 bg-muted/30"
 >
 {/* Field */}
 <Select
 value={rule.field}
 onValueChange={val => updateRule(index, { field: val as PricingRule['field'] })}
 >
 <SelectTrigger className="w-28">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 {FIELDS.map(field => (
 <SelectItem key={field.value} value={field.value}>
 {field.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>

 {/* Operator */}
 <Select
 value={rule.op}
 onValueChange={val => updateRule(index, { op: val as PricingRule['op'] })}
 >
 <SelectTrigger className="w-20">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 {OPERATORS.map(op => (
 <SelectItem key={op.value} value={op.value}>
 {op.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>

 {/* Value */}
 <Input
 type={rule.field === 'age' || rule.field === 'income' ? 'number' : 'text'}
 value={String(rule.val)}
 onChange={e => {
 const val =
 rule.field === 'age' || rule.field === 'income'
 ? parseInt(e.target.value, 10) || 0
 : e.target.value;
 updateRule(index, { val });
 }}
 className="w-24"
 placeholder="Value"
 />

 {/* Adjustment */}
 <div className="flex items-center gap-1">
 <span className="text-muted-foreground">$</span>
 <Input
 type="text"
 value={rule.adjustment.replace(/^[+-]/, '')}
 onChange={e => {
 const sign = rule.adjustment.startsWith('-') ? '-' : '+';
 updateRule(index, { adjustment: formatAdjustment(sign + e.target.value) });
 }}
 className="w-20"
 placeholder="0.00"
 />
 <Select
 value={rule.adjustment.startsWith('-') ? 'subtract' : 'add'}
 onValueChange={val => {
 const amount = rule.adjustment.replace(/^[+-]/, '');
 updateRule(index, {
 adjustment: val === 'subtract' ? `-${amount}` : `+${amount}`,
 });
 }}
 >
 <SelectTrigger className="w-20">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="add">Add</SelectItem>
 <SelectItem value="subtract">Subtract</SelectItem>
 </SelectContent>
 </Select>
 </div>

 {/* Delete Button */}
 <Button
 type="button"
 variant="ghost"
 size="icon"
 onClick={() => removeRule(index)}
 className="h-8 w-8 text-destructive hover:text-destructive"
 >
 <Trash2 className="h-4 w-4" />
 </Button>
 </div>
 ))}
 </div>
 )}

 {/* Preview */}
 {rules.length > 0 && (
 <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
 <p className="font-medium mb-1">Example Calculation:</p>
 <p>
 Base: ${basePrice.toFixed(2)}
 {rules.slice(0, 2).map((rule, i) => (
 <span key={i}>
 {' '}
 {rule.adjustment.startsWith('-') ? '-' : '+'} $
 {rule.adjustment.replace(/^[+-]/, '')} (if {rule.field}{' '}
 {OPERATORS.find(o => o.value === rule.op)?.label} {String(rule.val)})
 </span>
 ))}
 {rules.length > 2 && <span> + {rules.length - 2} more rules</span>}
 </p>
 </div>
 )}
 </div>
 </div>
 );
}

