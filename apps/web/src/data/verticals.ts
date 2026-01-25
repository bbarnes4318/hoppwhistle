/**
 * Project Cortex | Verticals Data
 *
 * High-value PPCall verticals with color coding.
 */

import type { Vertical } from '@/types/ppcall';

export const VERTICALS: Vertical[] = [
  // Insurance
  {
    id: 'medicare',
    name: 'Medicare Advantage',
    shortName: 'MEDICARE',
    category: 'insurance',
    color: 'cyan',
    icon: '🏥',
    avgPayout: 45,
    avgDuration: 180,
  },
  {
    id: 'aca',
    name: 'ACA Health Insurance',
    shortName: 'ACA',
    category: 'insurance',
    color: 'cyan',
    icon: '🏥',
    avgPayout: 35,
    avgDuration: 150,
  },
  {
    id: 'final-expense',
    name: 'Final Expense',
    shortName: 'FINAL EXP',
    category: 'insurance',
    color: 'cyan',
    icon: '📋',
    avgPayout: 25,
    avgDuration: 120,
  },
  {
    id: 'auto-insurance',
    name: 'Auto Insurance',
    shortName: 'AUTO',
    category: 'insurance',
    color: 'cyan',
    icon: '🚗',
    avgPayout: 18,
    avgDuration: 90,
  },

  // Legal
  {
    id: 'mass-tort',
    name: 'Mass Tort',
    shortName: 'MASS TORT',
    category: 'legal',
    color: 'violet',
    icon: '⚖️',
    avgPayout: 150,
    avgDuration: 240,
  },
  {
    id: 'personal-injury',
    name: 'Personal Injury',
    shortName: 'PI',
    category: 'legal',
    color: 'violet',
    icon: '⚖️',
    avgPayout: 85,
    avgDuration: 180,
  },
  {
    id: 'mvaa',
    name: 'Motor Vehicle Accidents',
    shortName: 'MVA',
    category: 'legal',
    color: 'violet',
    icon: '🚙',
    avgPayout: 65,
    avgDuration: 150,
  },

  // Home Services
  {
    id: 'roofing',
    name: 'Roofing',
    shortName: 'ROOFING',
    category: 'home_services',
    color: 'lime',
    icon: '🏠',
    avgPayout: 35,
    avgDuration: 90,
  },
  {
    id: 'solar',
    name: 'Solar Installation',
    shortName: 'SOLAR',
    category: 'home_services',
    color: 'lime',
    icon: '☀️',
    avgPayout: 45,
    avgDuration: 120,
  },
  {
    id: 'hvac',
    name: 'HVAC',
    shortName: 'HVAC',
    category: 'home_services',
    color: 'lime',
    icon: '❄️',
    avgPayout: 28,
    avgDuration: 90,
  },
  {
    id: 'plumbing',
    name: 'Plumbing',
    shortName: 'PLUMBING',
    category: 'home_services',
    color: 'lime',
    icon: '🔧',
    avgPayout: 22,
    avgDuration: 60,
  },

  // DME
  {
    id: 'dme-back-brace',
    name: 'Back Brace',
    shortName: 'BACK BRACE',
    category: 'dme',
    color: 'mint',
    icon: '🩺',
    avgPayout: 55,
    avgDuration: 180,
  },
  {
    id: 'dme-cgm',
    name: 'CGM Monitors',
    shortName: 'CGM',
    category: 'dme',
    color: 'mint',
    icon: '📊',
    avgPayout: 75,
    avgDuration: 210,
  },
  {
    id: 'dme-cpap',
    name: 'CPAP Supplies',
    shortName: 'CPAP',
    category: 'dme',
    color: 'mint',
    icon: '😴',
    avgPayout: 40,
    avgDuration: 150,
  },
];

/**
 * Get vertical by ID
 */
export function getVertical(id: string): Vertical | undefined {
  return VERTICALS.find(v => v.id === id);
}

/**
 * Get verticals by category
 */
export function getVerticalsByCategory(category: string): Vertical[] {
  return VERTICALS.filter(v => v.category === category);
}

/**
 * Get vertical color class
 */
export function getVerticalColorClass(color: Vertical['color']): string {
  const colorMap = {
    cyan: 'text-neon-cyan bg-neon-cyan/10 border-neon-cyan/30',
    violet: 'text-neon-violet bg-neon-violet/10 border-neon-violet/30',
    lime: 'text-toxic-lime bg-toxic-lime/10 border-toxic-lime/30',
    mint: 'text-neon-mint bg-neon-mint/10 border-neon-mint/30',
  };
  return colorMap[color];
}
