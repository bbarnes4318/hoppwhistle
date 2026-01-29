/**
 * Settings Service - Manages user preferences stored in localStorage
 * Handles carrier selection preferences for quote filtering
 */

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULTS & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

// All available carriers
export const ALL_CARRIERS = [
  'American Amicable',
  'Corebridge',
  'TransAmerica',
  'Aflac',
  'SBLI',
  'CICA',
  'GTL',
  'AHL',
  'Royal Neighbors',
  'Gerber',
  'Mutual of Omaha',
] as const;

export type CarrierName = (typeof ALL_CARRIERS)[number];

export interface Settings {
  enabledCarriers: string[];
  version: string;
}

// Default settings - all carriers enabled
const DEFAULT_SETTINGS: Settings = {
  enabledCarriers: [...ALL_CARRIERS],
  version: '1.0',
};

const STORAGE_KEY = 'hopwhistle_settings';
let subscribers: Array<(settings: Settings) => void> = [];

// ═══════════════════════════════════════════════════════════════════════════
// GETTERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all settings from localStorage
 */
export function getSettings(): Settings {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS };

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to ensure all fields exist
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        // Ensure enabledCarriers is always an array
        enabledCarriers: Array.isArray(parsed.enabledCarriers)
          ? parsed.enabledCarriers
          : DEFAULT_SETTINGS.enabledCarriers,
      };
    }
  } catch (err) {
    console.warn('[Settings] Failed to load settings from localStorage:', err);
  }
  return { ...DEFAULT_SETTINGS };
}

/**
 * Get list of enabled carriers
 */
export function getEnabledCarriers(): string[] {
  const settings = getSettings();
  return settings.enabledCarriers || [...ALL_CARRIERS];
}

/**
 * Check if a specific carrier is enabled
 */
export function isCarrierEnabled(carrier: string): boolean {
  const enabled = getEnabledCarriers();
  return enabled.includes(carrier);
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Save settings to localStorage
 */
export function saveSettings(settings: Partial<Settings>): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const toSave = {
      ...getSettings(),
      ...settings,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    notifySubscribers(toSave);
    console.log('[Settings] Saved:', toSave);
    return true;
  } catch (err) {
    console.error('[Settings] Failed to save settings:', err);
    return false;
  }
}

/**
 * Set enabled carriers
 */
export function setEnabledCarriers(carriers: string[]): boolean {
  if (!Array.isArray(carriers)) {
    console.error('[Settings] setEnabledCarriers expects an array');
    return false;
  }
  // Validate carriers
  const validCarriers = carriers.filter(c => ALL_CARRIERS.includes(c as CarrierName));
  return saveSettings({ enabledCarriers: validCarriers });
}

/**
 * Toggle a single carrier
 */
export function toggleCarrier(carrier: string): boolean {
  const current = getEnabledCarriers();
  if (current.includes(carrier)) {
    // Prevent disabling all carriers - keep at least one
    if (current.length <= 1) {
      console.warn('[Settings] Cannot disable last carrier');
      return false;
    }
    return setEnabledCarriers(current.filter(c => c !== carrier));
  } else {
    return setEnabledCarriers([...current, carrier]);
  }
}

/**
 * Enable all carriers
 */
export function enableAllCarriers(): boolean {
  return setEnabledCarriers([...ALL_CARRIERS]);
}

/**
 * Reset settings to defaults
 */
export function resetSettings(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    localStorage.removeItem(STORAGE_KEY);
    notifySubscribers(DEFAULT_SETTINGS);
    console.log('[Settings] Reset to defaults');
    return true;
  } catch (err) {
    console.error('[Settings] Failed to reset settings:', err);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SUBSCRIPTION (for real-time updates)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Subscribe to settings changes
 */
export function subscribeToSettings(callback: (settings: Settings) => void): () => void {
  subscribers.push(callback);
  return () => {
    subscribers = subscribers.filter(cb => cb !== callback);
  };
}

function notifySubscribers(settings: Settings): void {
  subscribers.forEach(cb => {
    try {
      cb(settings);
    } catch (err) {
      console.error('[Settings] Subscriber error:', err);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// CARRIER INFO HELPERS
// ═══════════════════════════════════════════════════════════════════════════

export interface CarrierInfo {
  logo: string;
  plans: string[];
  description: string;
}

/**
 * Get carrier metadata for UI display
 */
export const CARRIER_INFO: Record<string, CarrierInfo> = {
  'American Amicable': {
    logo: '/logos/amam.png',
    plans: ['Level', 'Graded', 'ROP'],
    description: 'Final expense specialist with Level, Graded, and ROP options',
  },
  Corebridge: {
    logo: '/logos/corebridge.png',
    plans: ['Guaranteed Issue'],
    description: 'Guaranteed Issue - no health questions',
  },
  TransAmerica: {
    logo: '/logos/trans.png',
    plans: ['Level', 'Graded'],
    description: 'Level and Graded coverage options',
  },
  Aflac: {
    logo: '/logos/aflac.png',
    plans: ['Level', 'Modified'],
    description: 'Level and Modified benefit plans',
  },
  SBLI: {
    logo: '/logos/sbli.png',
    plans: ['Level', 'Modified'],
    description: 'Level and Modified coverage',
  },
  CICA: {
    logo: '/logos/cica.png',
    plans: ['Level', 'Guaranteed Issue'],
    description: 'Level and Guaranteed Issue options',
  },
  GTL: {
    logo: '/logos/gtl.png',
    plans: ['Graded'],
    description: 'Graded benefit coverage',
  },
  AHL: {
    logo: '/logos/ahl.png',
    plans: ['Level', 'Graded'],
    description: 'Level and Graded plans',
  },
  'Royal Neighbors': {
    logo: '/logos/royal.png',
    plans: ['Level', 'Graded'],
    description: 'Fraternal benefit society',
  },
  Gerber: {
    logo: '/logos/gerber.png',
    plans: ['Guaranteed Issue'],
    description: 'Guaranteed Issue coverage',
  },
  'Mutual of Omaha': {
    logo: '/logos/mutual.png',
    plans: ['Level', 'Graded'],
    description: 'Level and Graded whole life',
  },
};
