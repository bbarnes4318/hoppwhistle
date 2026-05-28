// Phone number geography resolver and campaign aggregators
// Decoupled business logic for geospatial OUTBOUND campaign intelligence

export interface GeoResolution {
  latitude: number;
  longitude: number;
  city?: string;
  state?: string;
  areaCode?: string;
  npa?: string;
  nxx?: string;
  npaNxx?: string;
  source: 'crm_verified' | 'lead_metadata' | 'npa_nxx' | 'area_code' | 'unknown';
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  warning?: string;
}

export interface GeoMetricPoint {
  id: string;
  campaignId: string;
  label: string;
  state?: string;
  city?: string;
  areaCode?: string;
  npa?: string;
  nxx?: string;
  npaNxx?: string;
  latitude: number;
  longitude: number;
  locationSource: 'crm_verified' | 'lead_metadata' | 'npa_nxx' | 'area_code' | 'unknown';
  locationConfidence: 'high' | 'medium' | 'low' | 'unknown';
  contacted: number;
  answered: number;
  verifiedListens: number;
  engagements: number;
  optIns: number;
  callbacks: number;
  transfers: number;
  conversions: number;
  dnc: number;
  spend: number;
  revenue: number;
  revenueMovement: number;
  answerRate: number;
  listenRate: number;
  engagementRate: number;
  transferRate: number;
  conversionRate: number;
  costPerAnswer: number;
  costPerVerifiedListen: number;
  costPerTransfer: number;
  costPerConversion: number;
  lastActivityAt?: string;
}

// Representative U.S. Area Code Centroids (NPA lookup baseline)
export const baselineAreaCodeCentroids: Record<
  string,
  { lat: number; lng: number; city: string; state: string }
> = {
  // Florida
  '305': { lat: 25.7617, lng: -80.1918, city: 'Miami', state: 'FL' },
  '786': { lat: 25.7617, lng: -80.1918, city: 'Miami', state: 'FL' },
  '407': { lat: 28.5383, lng: -81.3792, city: 'Orlando', state: 'FL' },
  '813': { lat: 27.9506, lng: -82.4572, city: 'Tampa', state: 'FL' },
  '904': { lat: 30.3322, lng: -81.6557, city: 'Jacksonville', state: 'FL' },
  '954': { lat: 26.1224, lng: -80.1373, city: 'Fort Lauderdale', state: 'FL' },
  // Texas
  '214': { lat: 32.7767, lng: -96.797, city: 'Dallas', state: 'TX' },
  '972': { lat: 32.7767, lng: -96.797, city: 'Dallas', state: 'TX' },
  '713': { lat: 29.7604, lng: -95.3698, city: 'Houston', state: 'TX' },
  '281': { lat: 29.7604, lng: -95.3698, city: 'Houston', state: 'TX' },
  '512': { lat: 30.2672, lng: -97.7431, city: 'Austin', state: 'TX' },
  '210': { lat: 29.4241, lng: -98.4936, city: 'San Antonio', state: 'TX' },
  // California
  '213': { lat: 34.0522, lng: -118.2437, city: 'Los Angeles', state: 'CA' },
  '310': { lat: 34.0194, lng: -118.4912, city: 'Santa Monica', state: 'CA' },
  '415': { lat: 37.7749, lng: -122.4194, city: 'San Francisco', state: 'CA' },
  '619': { lat: 32.7157, lng: -117.1611, city: 'San Diego', state: 'CA' },
  '408': { lat: 37.3382, lng: -121.8863, city: 'San Jose', state: 'CA' },
  // Georgia
  '404': { lat: 33.749, lng: -84.388, city: 'Atlanta', state: 'GA' },
  '770': { lat: 33.9526, lng: -84.5499, city: 'Marietta', state: 'GA' },
  // Pennsylvania
  '215': { lat: 39.9526, lng: -75.1652, city: 'Philadelphia', state: 'PA' },
  '412': { lat: 40.4406, lng: -79.9959, city: 'Pittsburgh', state: 'PA' },
  // Arizona
  '602': { lat: 33.4484, lng: -112.074, city: 'Phoenix', state: 'AZ' },
  '520': { lat: 32.2226, lng: -110.9747, city: 'Tucson', state: 'AZ' },
  // Ohio
  '216': { lat: 41.4993, lng: -81.6944, city: 'Cleveland', state: 'OH' },
  '614': { lat: 39.9612, lng: -82.9988, city: 'Columbus', state: 'OH' },
  // Nevada
  '702': { lat: 36.1716, lng: -115.1398, city: 'Las Vegas', state: 'NV' },
  // North Carolina
  '704': { lat: 35.2271, lng: -80.8431, city: 'Charlotte', state: 'NC' },
  '919': { lat: 35.7796, lng: -78.6382, city: 'Raleigh', state: 'NC' },
  // Tennessee
  '615': { lat: 36.1627, lng: -86.7816, city: 'Nashville', state: 'TN' },
  '901': { lat: 35.1495, lng: -90.049, city: 'Memphis', state: 'TN' },
  // Michigan
  '313': { lat: 42.3314, lng: -83.0458, city: 'Detroit', state: 'MI' },
  '616': { lat: 42.9634, lng: -85.6681, city: 'Grand Rapids', state: 'MI' },
  // New York
  '212': { lat: 40.7128, lng: -74.006, city: 'New York', state: 'NY' },
  '718': { lat: 40.6782, lng: -73.9442, city: 'Brooklyn', state: 'NY' },
  // Illinois
  '312': { lat: 41.8781, lng: -87.6298, city: 'Chicago', state: 'IL' },
  // Washington
  '206': { lat: 47.6062, lng: -122.3321, city: 'Seattle', state: 'WA' },
  // Colorado
  '303': { lat: 39.7392, lng: -104.9903, city: 'Denver', state: 'CO' },
  // Massachusetts
  '617': { lat: 42.3601, lng: -71.0589, city: 'Boston', state: 'MA' },
};

// Representative U.S. NPA-NXX Prefixes (NPA-NXX lookup baseline)
export const baselineNpaNxxCentroids: Record<
  string,
  { lat: number; lng: number; city: string; state: string }
> = {
  // Miami Prefixes
  '305200': { lat: 25.7711, lng: -80.192, city: 'Miami Brickell', state: 'FL' },
  '305555': { lat: 25.82, lng: -80.28, city: 'Miami Springs', state: 'FL' },
  // Dallas Prefixes
  '214500': { lat: 32.785, lng: -96.791, city: 'Dallas Downtown', state: 'TX' },
  '972800': { lat: 33.0198, lng: -96.6989, city: 'Plano', state: 'TX' },
  // Atlanta Prefixes
  '404200': { lat: 33.755, lng: -84.39, city: 'Atlanta Mid', state: 'GA' },
  // Phoenix Prefixes
  '602300': { lat: 33.455, lng: -112.064, city: 'Phoenix North', state: 'AZ' },
  // Las Vegas Prefixes
  '702400': { lat: 36.12, lng: -115.17, city: 'Las Vegas Strip', state: 'NV' },
};

// 1. Normalize Phone Number
export function normalizePhoneNumber(phone: string): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return cleaned.slice(1);
  }
  if (cleaned.length === 10) {
    return cleaned;
  }
  return cleaned.length > 0 ? cleaned : null;
}

// 2. Extract NPA (Area Code)
export function extractNpa(phone: string): string | null {
  const norm = normalizePhoneNumber(phone);
  if (norm && norm.length >= 3) {
    return norm.slice(0, 3);
  }
  return null;
}

// 3. Extract NPA-NXX (Area Code + Prefix)
export function extractNpaNxx(phone: string): string | null {
  const norm = normalizePhoneNumber(phone);
  if (norm && norm.length >= 6) {
    return norm.slice(0, 6);
  }
  return null;
}

export interface LeadMetadata {
  latitude?: number | string;
  longitude?: number | string;
  lat?: number | string;
  lng?: number | string;
  lon?: number | string;
  city?: string;
  state?: string;
  verified?: boolean;
}

// 4. Resolve Phone Geography
export function resolvePhoneGeo(phone: string, leadMetadata?: LeadMetadata): GeoResolution {
  const norm = normalizePhoneNumber(phone) || '';
  const npa = extractNpa(norm) || '';
  const npaNxx = extractNpaNxx(norm) || '';
  const nxx = norm.length >= 6 ? norm.slice(3, 6) : '';

  // Strategy 1: Check CRM / Lead Metadata verified values
  if (leadMetadata) {
    const lat = Number(leadMetadata.latitude || leadMetadata.lat);
    const lng = Number(leadMetadata.longitude || leadMetadata.lng || leadMetadata.lon);
    const city = leadMetadata.city;
    const state = leadMetadata.state;

    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
      return {
        latitude: lat,
        longitude: lng,
        city,
        state,
        areaCode: npa,
        npa,
        nxx,
        npaNxx,
        source: leadMetadata.verified ? 'crm_verified' : 'lead_metadata',
        confidence: leadMetadata.verified ? 'high' : 'medium',
      };
    }
  }

  // Strategy 2: NPA-NXX lookup
  if (npaNxx && baselineNpaNxxCentroids[npaNxx]) {
    const entry = baselineNpaNxxCentroids[npaNxx];
    return {
      latitude: entry.lat,
      longitude: entry.lng,
      city: entry.city,
      state: entry.state,
      areaCode: npa,
      npa,
      nxx,
      npaNxx,
      source: 'npa_nxx',
      confidence: 'medium',
    };
  }

  // Strategy 3: Area-code centroid lookup
  if (npa && baselineAreaCodeCentroids[npa]) {
    const entry = baselineAreaCodeCentroids[npa];
    return {
      latitude: entry.lat,
      longitude: entry.lng,
      city: entry.city,
      state: entry.state,
      areaCode: npa,
      npa,
      nxx,
      npaNxx,
      source: 'area_code',
      confidence: 'low',
      warning: 'Approximate location mapped to Area Code center.',
    };
  }

  // Strategy 4: Unknown bucket
  // Default to U.S. center centroid to avoid map crashes, marked clearly as unknown
  return {
    latitude: 39.8283,
    longitude: -98.5795,
    city: 'Unknown',
    state: undefined,
    areaCode: npa || undefined,
    npa: npa || undefined,
    npaNxx: npaNxx || undefined,
    source: 'unknown',
    confidence: 'unknown',
    warning: 'Phone number could not be confidently mapped.',
  };
}

// Calculate Rates for stats/KPIs
export function calculateRates(p: Partial<GeoMetricPoint>): Partial<GeoMetricPoint> {
  const contacted = p.contacted || 0;
  const answered = p.answered || 0;
  const verifiedListens = p.verifiedListens || 0;
  const engagements = p.engagements || 0;
  const transfers = p.transfers || 0;
  const conversions = p.conversions || 0;
  const spend = p.spend || 0;

  return {
    ...p,
    answerRate: contacted > 0 ? Number(((answered / contacted) * 100).toFixed(1)) : 0,
    listenRate: answered > 0 ? Number(((verifiedListens / answered) * 100).toFixed(1)) : 0,
    engagementRate: answered > 0 ? Number(((engagements / answered) * 100).toFixed(1)) : 0,
    transferRate: answered > 0 ? Number(((transfers / answered) * 100).toFixed(1)) : 0,
    conversionRate: transfers > 0 ? Number(((conversions / transfers) * 100).toFixed(1)) : 0,
    costPerAnswer: answered > 0 ? Number((spend / answered).toFixed(2)) : 0,
    costPerVerifiedListen: verifiedListens > 0 ? Number((spend / verifiedListens).toFixed(2)) : 0,
    costPerTransfer: transfers > 0 ? Number((spend / transfers).toFixed(2)) : 0,
    costPerConversion: conversions > 0 ? Number((spend / conversions).toFixed(2)) : 0,
  } as Partial<GeoMetricPoint>;
}

// Recommendation Engine
export function calculateRecommendation(
  p: Partial<GeoMetricPoint>
): 'scale' | 'watch' | 'pause' | 'investigate' {
  const answered = p.answered || 0;
  const answerRate = answered > 0 && p.contacted ? (answered / p.contacted) * 100 : 0;
  const listenRate = answered > 0 && p.verifiedListens ? (p.verifiedListens / answered) * 100 : 0;
  const transferRate = answered > 0 && p.transfers ? (p.transfers / answered) * 100 : 0;
  const dncRate = answered > 0 && p.dnc ? (p.dnc / answered) * 100 : 0;
  const revenueMovement = p.revenueMovement || 0;

  // Scale: High connect rate, good listen quality, low opt-outs, positive yield
  if (
    answered >= 5 &&
    listenRate >= 50 &&
    transferRate >= 15 &&
    dncRate < 5 &&
    revenueMovement >= 0
  ) {
    return 'scale';
  }
  // Pause: Low connect rates, high opt-outs, high relative costs with negative return
  if (
    answered >= 5 &&
    (answerRate < 10 || dncRate >= 12 || (p.spend && p.spend > 100 && transferRate < 5))
  ) {
    return 'pause';
  }
  // Investigate: High answers/listens but weak conversions or weird metrics
  if (answered >= 5 && listenRate >= 60 && transferRate < 5) {
    return 'investigate';
  }
  // Watch: Low volume / early data
  return 'watch';
}

// Compute Performance Score (0-100 range)
export function calculateMarketScore(p: Partial<GeoMetricPoint>): number {
  const rates = calculateRates(p);
  const lRate = rates.listenRate || 0;
  const tRate = rates.transferRate || 0;
  const cRate = rates.conversionRate || 0;
  const dRate = p.answered && p.answered > 0 && p.dnc ? (p.dnc / p.answered) * 100 : 0;

  // Weighted formula: Listen Quality (30%), Transfer Yield (40%), Conversion Success (30%), minus DNC penalty
  const raw = lRate * 0.3 + tRate * 4.0 * 0.4 + cRate * 0.3 - dRate * 1.5;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

// 5. Aggregate By State
export function aggregateByState(points: GeoMetricPoint[]): GeoMetricPoint[] {
  const stateGroups: Record<string, GeoMetricPoint[]> = {};
  points.forEach(p => {
    const key = p.state || 'Unknown State';
    if (!stateGroups[key]) stateGroups[key] = [];
    stateGroups[key].push(p);
  });

  return Object.entries(stateGroups).map(([state, group]) => {
    const base = sumGroupMetrics(group, `state-${state}`, state);
    base.state = state;
    base.label = state;
    // Compute mean coordinates
    const lats = group.map(g => g.latitude);
    const lngs = group.map(g => g.longitude);
    base.latitude = lats.reduce((a, b) => a + b, 0) / group.length;
    base.longitude = lngs.reduce((a, b) => a + b, 0) / group.length;
    return calculateRates(base) as GeoMetricPoint;
  });
}

// 6. Aggregate By Area Code
export function aggregateByAreaCode(points: GeoMetricPoint[]): GeoMetricPoint[] {
  const npaGroups: Record<string, GeoMetricPoint[]> = {};
  points.forEach(p => {
    const key = p.areaCode || 'Unknown Area Code';
    if (!npaGroups[key]) npaGroups[key] = [];
    npaGroups[key].push(p);
  });

  return Object.entries(npaGroups).map(([npa, group]) => {
    const state = group[0]?.state || '';
    const city = group[0]?.city || '';
    const base = sumGroupMetrics(group, `npa-${npa}`, `(${npa}) ${city}, ${state}`);
    base.areaCode = npa;
    base.npa = npa;
    base.state = state;
    base.city = city;
    base.latitude = group[0]?.latitude || 39.8283;
    base.longitude = group[0]?.longitude || -98.5795;
    return calculateRates(base) as GeoMetricPoint;
  });
}

// Helper to sum metric fields
function sumGroupMetrics(
  group: GeoMetricPoint[],
  id: string,
  label: string
): Partial<GeoMetricPoint> {
  const sum = {
    id,
    campaignId: group[0]?.campaignId || 'all',
    label,
    contacted: 0,
    answered: 0,
    verifiedListens: 0,
    engagements: 0,
    optIns: 0,
    callbacks: 0,
    transfers: 0,
    conversions: 0,
    dnc: 0,
    spend: 0,
    revenue: 0,
    revenueMovement: 0,
    locationSource: group[0]?.locationSource || 'unknown',
    locationConfidence: group[0]?.locationConfidence || 'unknown',
  };

  group.forEach(g => {
    sum.contacted += g.contacted || 0;
    sum.answered += g.answered || 0;
    sum.verifiedListens += g.verifiedListens || 0;
    sum.engagements += g.engagements || 0;
    sum.optIns += g.optIns || 0;
    sum.callbacks += g.callbacks || 0;
    sum.transfers += g.transfers || 0;
    sum.conversions += g.conversions || 0;
    sum.dnc += g.dnc || 0;
    sum.spend += g.spend || 0;
    sum.revenue += g.revenue || 0;
    sum.revenueMovement += g.revenueMovement || 0;
  });

  return sum;
}
