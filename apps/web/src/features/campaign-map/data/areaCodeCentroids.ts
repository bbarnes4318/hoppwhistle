import { baselineAreaCodeCentroids } from '@hopwhistle/shared';

// Extend or customize baseline area code centroids for the frontend visualization
export interface AreaCodeCentroid {
  lat: number;
  lng: number;
  city: string;
  state: string;
}

export const areaCodeCentroids: Record<string, AreaCodeCentroid> = {
  ...baselineAreaCodeCentroids,

  // Extra detailed centroids for high density mapping
  '727': { lat: 27.8398, lng: -82.6845, city: 'St. Petersburg', state: 'FL' },
  '561': { lat: 26.7153, lng: -80.0534, city: 'West Palm Beach', state: 'FL' },
  '321': { lat: 28.3852, lng: -80.6031, city: 'Cocoa Beach', state: 'FL' },
  '239': { lat: 26.6406, lng: -81.8723, city: 'Fort Myers', state: 'FL' },

  '817': { lat: 32.7555, lng: -97.3308, city: 'Fort Worth', state: 'TX' },
  '832': { lat: 29.7604, lng: -95.3698, city: 'Houston Metro', state: 'TX' },
  '915': { lat: 31.7619, lng: -106.485, city: 'El Paso', state: 'TX' },

  '678': { lat: 33.749, lng: -84.388, city: 'Atlanta Suburbs', state: 'GA' },
  '912': { lat: 32.0809, lng: -81.0912, city: 'Savannah', state: 'GA' },

  '480': { lat: 33.4255, lng: -111.94, city: 'Tempe', state: 'AZ' },
  '623': { lat: 33.5387, lng: -112.186, city: 'Glendale', state: 'AZ' },

  '8ebe': { lat: 39.8283, lng: -98.5795, city: 'Unknown', state: 'US' },
};

export function getAreaCodeCentroid(npa: string): AreaCodeCentroid | null {
  return areaCodeCentroids[npa] || null;
}
