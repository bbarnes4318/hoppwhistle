import { baselineNpaNxxCentroids } from '@hopwhistle/shared';

export interface NpaNxxCentroid {
  lat: number;
  lng: number;
  city: string;
  state: string;
}

export const npaNxxSample: Record<string, NpaNxxCentroid> = {
  ...baselineNpaNxxCentroids,

  // Additional mock prefixes for prefix-level detail
  '305300': { lat: 25.758, lng: -80.193, city: 'Miami Brickell RateCenter', state: 'FL' },
  '305301': { lat: 25.789, lng: -80.14, city: 'Miami Beach South RateCenter', state: 'FL' },
  '305302': { lat: 25.735, lng: -80.243, city: 'Coconut Grove RateCenter', state: 'FL' },

  '214500': { lat: 32.78, lng: -96.79, city: 'Dallas Main RateCenter', state: 'TX' },
  '214501': { lat: 32.82, lng: -96.77, city: 'Dallas Lakewood RateCenter', state: 'TX' },

  '404200': { lat: 33.75, lng: -84.38, city: 'Atlanta Peachtree RateCenter', state: 'GA' },
  '404201': { lat: 33.785, lng: -84.36, city: 'Atlanta Midtown RateCenter', state: 'GA' },

  '702400': { lat: 36.115, lng: -115.172, city: 'Las Vegas Strip RateCenter', state: 'NV' },
  '702401': { lat: 36.14, lng: -115.2, city: 'Las Vegas West RateCenter', state: 'NV' },

  '602300': { lat: 33.45, lng: -112.07, city: 'Phoenix Central RateCenter', state: 'AZ' },
  '602301': { lat: 33.51, lng: -112.02, city: 'Phoenix Camelback RateCenter', state: 'AZ' },
};

export function getNpaNxxCentroid(npaNxx: string): NpaNxxCentroid | null {
  return npaNxxSample[npaNxx] || null;
}
