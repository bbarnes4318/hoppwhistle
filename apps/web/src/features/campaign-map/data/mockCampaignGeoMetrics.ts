import { GeoMetricPoint, calculateRates } from '@hopwhistle/shared';

import { areaCodeCentroids } from './areaCodeCentroids';
import { npaNxxSample } from './npaNxxSample';

// Outbound AI voice campaigns
export const mockCampaigns = [
  { id: 'c1', name: 'Final Expense Senior Lead Gen', type: 'Outbound Lead Gen' },
  { id: 'c2', name: 'ACA Enrollment Inbound/Outbound Match', type: 'Health Insurance Outreach' },
  { id: 'c3', name: 'Medicare Open Enrollment Special Campaign', type: 'Medicare Campaigns' },
];

// Seeded random helper for reproducible coordinates and metrics
function seededRandom(seed: number) {
  const x = Math.sin(seed++) * 10000;
  return x - Math.floor(x);
}

export function generateMockCampaignGeoMetrics(campaignId: string = 'all'): GeoMetricPoint[] {
  const points: GeoMetricPoint[] = [];
  const areaCodeList = Object.keys(areaCodeCentroids);
  const npaNxxList = Object.keys(npaNxxSample);

  // Total points to generate for visual stress testing
  const totalPoints = 12000;
  let seed = 12345;

  const targetCampaign = campaignId === 'all' ? 'c1' : campaignId;

  // Let's create realistic outbound distribution:
  // High density clusters in Florida, Texas, Georgia, California, Pennsylvania, Ohio, Nevada, Arizona
  const highDensityStates = ['FL', 'TX', 'GA', 'CA', 'PA', 'OH', 'NV', 'AZ'];

  for (let i = 0; i < totalPoints; i++) {
    // Determine Area Code & Location Source
    const randAC = seededRandom(seed++);
    const npa = areaCodeList[Math.floor(randAC * areaCodeList.length)];
    const centroid = areaCodeCentroids[npa];

    if (!centroid) continue;

    // Apply geographic jitter to represent individual phone numbers/market nodes
    const jitterFactor = highDensityStates.includes(centroid.state) ? 0.35 : 1.2;
    const latJitter = (seededRandom(seed++) - 0.5) * jitterFactor;
    const lngJitter = (seededRandom(seed++) - 0.5) * jitterFactor;
    const latitude = centroid.lat + latJitter;
    const longitude = centroid.lng + lngJitter;

    // Determine confidence and location resolution source
    const sourceRand = seededRandom(seed++);
    let locationSource: GeoMetricPoint['locationSource'] = 'area_code';
    let locationConfidence: GeoMetricPoint['locationConfidence'] = 'low';
    let city = centroid.city;
    let npaNxx = npa + '200'; // default mock prefix

    if (sourceRand > 0.85) {
      locationSource = 'crm_verified';
      locationConfidence = 'high';
      city = `Verified Lead (${centroid.city})`;
    } else if (sourceRand > 0.5) {
      locationSource = 'npa_nxx';
      locationConfidence = 'medium';
      // Pick matching prefix if available
      const matchingPrefix = npaNxxList.find(p => p.startsWith(npa));
      if (matchingPrefix) {
        npaNxx = matchingPrefix;
        city = npaNxxSample[matchingPrefix].city;
      } else {
        npaNxx = npa + Math.floor(100 + seededRandom(seed++) * 899).toString();
        city = `Market prefix ${npaNxx.slice(3)}`;
      }
    } else if (sourceRand < 0.05) {
      locationSource = 'unknown';
      locationConfidence = 'unknown';
      city = 'Unknown Market';
    }

    // Outbound campaign call metrics simulation
    // Ensure high-density states perform slightly better to show clear regional patterns
    const isHighPerf = highDensityStates.includes(centroid.state);
    const scale = isHighPerf ? 1.6 : 0.8;

    const contacted = Math.floor(2 + seededRandom(seed++) * 48 * scale);
    const answered = Math.floor(contacted * (0.2 + seededRandom(seed++) * 0.45 * scale));
    const verifiedListens = Math.floor(answered * (0.35 + seededRandom(seed++) * 0.45));
    const engagements = Math.floor(verifiedListens * (0.4 + seededRandom(seed++) * 0.4));

    // High-funnel conversion triggers
    const optIns =
      seededRandom(seed++) > 0.75
        ? Math.floor(engagements * (0.1 + seededRandom(seed++) * 0.3))
        : 0;
    const callbacks =
      seededRandom(seed++) > 0.8 ? Math.floor(engagements * (0.1 + seededRandom(seed++) * 0.2)) : 0;

    // Direct transfer conversions
    const transfers =
      seededRandom(seed++) > 0.65
        ? Math.floor(engagements * (0.15 + seededRandom(seed++) * 0.3 * scale))
        : 0;
    const conversions =
      transfers > 0 ? Math.floor(transfers * (0.3 + seededRandom(seed++) * 0.5)) : 0;

    // Unsubscribe/DNC penalty
    const dnc =
      seededRandom(seed++) > 0.85 ? Math.floor(answered * (0.05 + seededRandom(seed++) * 0.12)) : 0;

    // Financial movement modeling
    const spend = contacted * 0.22; // $0.22 cost per outreach
    const revenue = conversions * 75.0 + optIns * 4.5; // $75 CPA payout + $4.50 lead value
    const revenueMovement = revenue - spend;

    const nxx = npaNxx.slice(3, 6);

    const basePoint: Partial<GeoMetricPoint> = {
      id: `pt-${i}-${campaignId}`,
      campaignId: targetCampaign,
      label: `${city}, ${centroid.state}`,
      state: centroid.state,
      city,
      areaCode: npa,
      npa,
      nxx,
      npaNxx,
      latitude,
      longitude,
      locationSource,
      locationConfidence,
      contacted,
      answered,
      verifiedListens,
      engagements,
      optIns,
      callbacks,
      transfers,
      conversions,
      dnc,
      spend,
      revenue,
      revenueMovement,
    };

    // Calculate rates and append recommendation badges
    const ratedPoint = calculateRates(basePoint) as GeoMetricPoint;
    ratedPoint.lastActivityAt = new Date(
      Date.now() - Math.floor(seededRandom(seed++) * 86400000)
    ).toISOString();

    points.push(ratedPoint);
  }

  // Filter based on campaignId selection
  return points;
}
