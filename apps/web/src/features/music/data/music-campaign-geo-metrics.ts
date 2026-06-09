import { GeoMetricPoint, calculateRates } from '@hopwhistle/shared';

import { areaCodeCentroids } from '@/features/campaign-map/data/areaCodeCentroids';
import { npaNxxSample } from '@/features/campaign-map/data/npaNxxSample';

export const musicCampaigns = [
  { id: 'mc-001', name: 'Summer Vibes Push', artist: 'Nova Eclipse', trackTitle: 'Golden Hour', type: 'Pre-Save Campaign' },
  { id: 'mc-002', name: 'Midnight Sessions', artist: 'DJ Phantom', trackTitle: 'Neon Dreams', type: 'VIP List Outreach' },
  { id: 'mc-003', name: 'Street Anthems Vol. 3', artist: 'Kilo Blaze', trackTitle: 'City Lights', type: 'Merch Drop Promo' },
  { id: 'mc-004', name: 'Soul Revival', artist: 'Aria James', trackTitle: 'Velvet Nights', type: 'Pre-Save Campaign' },
  { id: 'mc-005', name: 'Latin Heat', artist: 'Los Reyes', trackTitle: 'Fuego', type: 'Tour On-Sale Alert' },
  { id: 'mc-006', name: 'Indie Discovery', artist: 'Willow & Oak', trackTitle: 'Paper Wings', type: 'VIP List Outreach' },
  { id: 'mc-007', name: 'Bass Drop Festival', artist: 'SYNTHWAVE', trackTitle: 'Digital Storm', type: 'Listening Market Activation' },
];

function seededRandom(seed: number) {
  const x = Math.sin(seed++) * 10000;
  return x - Math.floor(x);
}

export function generateMusicCampaignGeoMetrics(campaignId: string = 'all'): GeoMetricPoint[] {
  const points: GeoMetricPoint[] = [];
  const areaCodeList = Object.keys(areaCodeCentroids);
  const npaNxxList = Object.keys(npaNxxSample);

  const totalPoints = 3000; // Dense enough for high-fidelity visualization
  let seed = 98765;

  // Representative high-density listening markets
  const majorMarkets = ['CA', 'NY', 'TX', 'FL', 'IL', 'GA', 'WA', 'TN', 'CO', 'MA'];

  for (let i = 0; i < totalPoints; i++) {
    const randAC = seededRandom(seed++);
    const npa = areaCodeList[Math.floor(randAC * areaCodeList.length)];
    const centroid = areaCodeCentroids[npa];

    if (!centroid) continue;

    // Apply jitter based on market density
    const jitterFactor = majorMarkets.includes(centroid.state) ? 0.45 : 1.3;
    const latJitter = (seededRandom(seed++) - 0.5) * jitterFactor;
    const lngJitter = (seededRandom(seed++) - 0.5) * jitterFactor;
    const latitude = centroid.lat + latJitter;
    const longitude = centroid.lng + lngJitter;

    const sourceRand = seededRandom(seed++);
    let locationSource: GeoMetricPoint['locationSource'] = 'area_code';
    let locationConfidence: GeoMetricPoint['locationConfidence'] = 'low';
    let city = centroid.city;
    let npaNxx = npa + '200';

    if (sourceRand > 0.85) {
      locationSource = 'crm_verified';
      locationConfidence = 'high';
      city = `${centroid.city} Verified Fan`;
    } else if (sourceRand > 0.5) {
      locationSource = 'npa_nxx';
      locationConfidence = 'medium';
      const matchingPrefix = npaNxxList.find(p => p.startsWith(npa));
      if (matchingPrefix) {
        npaNxx = matchingPrefix;
        city = npaNxxSample[matchingPrefix].city;
      } else {
        npaNxx = npa + Math.floor(100 + seededRandom(seed++) * 899).toString();
        city = `${centroid.city} Sector ${npaNxx.slice(3)}`;
      }
    } else if (sourceRand < 0.05) {
      locationSource = 'unknown';
      locationConfidence = 'unknown';
      city = 'Undetected Market';
    }

    // Pick a campaign
    const campaignIndex = Math.floor(seededRandom(seed++) * musicCampaigns.length);
    const campaign = musicCampaigns[campaignIndex];
    const targetCampaignId = campaignId === 'all' ? campaign.id : campaignId;

    // Simulate metrics based on market performance
    const isHighPerf = majorMarkets.includes(centroid.state);
    const perfScale = isHighPerf ? 1.5 : 0.7;

    const contacted = Math.floor(3 + seededRandom(seed++) * 35 * perfScale);
    const answered = Math.floor(contacted * (0.3 + seededRandom(seed++) * 0.4 * perfScale));
    const verifiedListens = Math.floor(answered * (0.4 + seededRandom(seed++) * 0.45));
    const engagements = Math.floor(verifiedListens * (0.45 + seededRandom(seed++) * 0.45));
    
    // Opt-ins represent Pre-Saves, Tour Alerts or Merch Sign-Ups
    const optIns = seededRandom(seed++) > 0.6
      ? Math.floor(engagements * (0.2 + seededRandom(seed++) * 0.5))
      : 0;
    
    const callbacks = seededRandom(seed++) > 0.8
      ? Math.floor(engagements * (0.1 + seededRandom(seed++) * 0.3))
      : 0;

    // In music context: transfers are DSP clickthroughs, conversions are pre-saves
    const transfers = Math.floor(engagements * (0.2 + seededRandom(seed++) * 0.4 * perfScale));
    const conversions = transfers > 0 
      ? Math.floor(transfers * (0.25 + seededRandom(seed++) * 0.5))
      : 0;

    // Unsubscribes / Opt-outs
    const dnc = seededRandom(seed++) > 0.85
      ? Math.floor(answered * (0.04 + seededRandom(seed++) * 0.1))
      : 0;

    // Costs & Revenue: $0.18 cost per contact, conversions represent save value ($4.50) + opt-in list value ($1.50)
    const spend = contacted * 0.18;
    const revenue = conversions * 4.5 + optIns * 1.5;
    const revenueMovement = revenue - spend;

    const nxx = npaNxx.slice(3, 6);

    const basePoint: Partial<GeoMetricPoint> = {
      id: `mpt-${i}-${campaign.id}`,
      campaignId: campaign.id,
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

    const ratedPoint = calculateRates(basePoint) as GeoMetricPoint;
    ratedPoint.lastActivityAt = new Date(
      Date.now() - Math.floor(seededRandom(seed++) * 86400000)
    ).toISOString();

    // If campaignId is filtered, only include matching points
    if (campaignId === 'all' || campaign.id === targetCampaignId) {
      points.push(ratedPoint);
    }
  }

  return points;
}
