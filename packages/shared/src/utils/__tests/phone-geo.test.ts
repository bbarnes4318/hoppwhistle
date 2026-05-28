import { describe, it, expect } from 'vitest';

import {
  normalizePhoneNumber,
  extractNpa,
  extractNpaNxx,
  resolvePhoneGeo,
  calculateRecommendation,
  calculateMarketScore,
  aggregateByState,
  aggregateByAreaCode,
  GeoMetricPoint,
} from '../phone-geo';

describe('Phone Geography Utilities', () => {
  describe('normalizePhoneNumber', () => {
    it('should clean characters and return 10 digits for US numbers', () => {
      expect(normalizePhoneNumber('+1 (305) 555-0199')).toBe('3055550199');
      expect(normalizePhoneNumber('305-555-0199')).toBe('3055550199');
      expect(normalizePhoneNumber('13055550199')).toBe('3055550199');
    });

    it('should return null for empty or invalid numbers', () => {
      expect(normalizePhoneNumber('')).toBeNull();
      expect(normalizePhoneNumber('abc')).toBeNull();
    });
  });

  describe('extractNpa & extractNpaNxx', () => {
    it('should extract 3-digit Area Code (NPA)', () => {
      expect(extractNpa('+1 (305) 555-0199')).toBe('305');
      expect(extractNpa('3055550199')).toBe('305');
    });

    it('should extract 6-digit Prefix (NPA-NXX)', () => {
      expect(extractNpaNxx('+1 (305) 555-0199')).toBe('305555');
      expect(extractNpaNxx('3055550199')).toBe('305555');
    });
  });

  describe('resolvePhoneGeo Fallback Order', () => {
    it('should prioritize CRM/Lead Metadata if present', () => {
      const meta = {
        latitude: 28.5383,
        longitude: -81.3792,
        city: 'Orlando',
        state: 'FL',
        verified: true,
      };
      const res = resolvePhoneGeo('3055550199', meta);
      expect(res.latitude).toBe(28.5383);
      expect(res.longitude).toBe(-81.3792);
      expect(res.city).toBe('Orlando');
      expect(res.state).toBe('FL');
      expect(res.source).toBe('crm_verified');
      expect(res.confidence).toBe('high');
    });

    it('should resolve to NPA-NXX prefix if CRM is missing but prefix matches', () => {
      // "305200" is in baselineNpaNxxCentroids (Miami Brickell, FL)
      const res = resolvePhoneGeo('3052000100');
      expect(res.latitude).toBe(25.7711);
      expect(res.longitude).toBe(-80.192);
      expect(res.city).toBe('Miami Brickell');
      expect(res.state).toBe('FL');
      expect(res.source).toBe('npa_nxx');
      expect(res.confidence).toBe('medium');
    });

    it('should resolve to Area Code if prefix is unknown but area code matches', () => {
      // "305" is in baselineAreaCodeCentroids (Miami, FL) but "305999" is not in NPA-NXX sample
      const res = resolvePhoneGeo('3059990100');
      expect(res.latitude).toBe(25.7617);
      expect(res.longitude).toBe(-80.1918);
      expect(res.city).toBe('Miami');
      expect(res.state).toBe('FL');
      expect(res.source).toBe('area_code');
      expect(res.confidence).toBe('low');
    });

    it('should fallback to unknown bucket if number has no matching area code', () => {
      const res = resolvePhoneGeo('9995550199');
      expect(res.source).toBe('unknown');
      expect(res.confidence).toBe('unknown');
      expect(res.city).toBe('Unknown');
    });
  });

  describe('calculateRecommendation', () => {
    it('should recommend scale for high performant metrics', () => {
      const point = {
        contacted: 10,
        answered: 8,
        verifiedListens: 6, // 75%
        transfers: 2, // 25%
        dnc: 0,
        revenueMovement: 100,
      };
      expect(calculateRecommendation(point)).toBe('scale');
    });

    it('should recommend pause for low connect rates or high DNCs', () => {
      const point = {
        contacted: 20,
        answered: 8,
        verifiedListens: 1,
        transfers: 0,
        dnc: 4, // 50% dnc rate
        spend: 120,
      };
      expect(calculateRecommendation(point)).toBe('pause');
    });
  });

  describe('calculateMarketScore', () => {
    it('should calculate score based on listens and transfers', () => {
      const point = {
        contacted: 10,
        answered: 8,
        verifiedListens: 6, // 75% -> 22.5 pts
        transfers: 2, // 25% -> 100% * 0.4 = 40 pts
        conversions: 2, // 100% -> 30 pts
        dnc: 0,
      };
      expect(calculateMarketScore(point)).toBe(93); // 22.5 + 40 + 30 = 92.5 -> 93
    });
  });

  describe('Aggregations', () => {
    const mockPoints: GeoMetricPoint[] = [
      {
        id: 'p1',
        campaignId: 'c1',
        label: 'Miami',
        state: 'FL',
        city: 'Miami',
        areaCode: '305',
        latitude: 25.76,
        longitude: -80.19,
        locationSource: 'area_code',
        locationConfidence: 'low',
        contacted: 10,
        answered: 5,
        verifiedListens: 3,
        engagements: 2,
        optIns: 1,
        callbacks: 0,
        transfers: 1,
        conversions: 1,
        dnc: 0,
        spend: 50,
        revenue: 100,
        revenueMovement: 50,
        answerRate: 0,
        listenRate: 0,
        engagementRate: 0,
        transferRate: 0,
        conversionRate: 0,
        costPerAnswer: 0,
        costPerVerifiedListen: 0,
        costPerTransfer: 0,
        costPerConversion: 0,
      },
      {
        id: 'p2',
        campaignId: 'c1',
        label: 'Tampa',
        state: 'FL',
        city: 'Tampa',
        areaCode: '813',
        latitude: 27.95,
        longitude: -82.45,
        locationSource: 'area_code',
        locationConfidence: 'low',
        contacted: 20,
        answered: 10,
        verifiedListens: 5,
        engagements: 4,
        optIns: 2,
        callbacks: 1,
        transfers: 2,
        conversions: 0,
        dnc: 1,
        spend: 100,
        revenue: 0,
        revenueMovement: -100,
        answerRate: 0,
        listenRate: 0,
        engagementRate: 0,
        transferRate: 0,
        conversionRate: 0,
        costPerAnswer: 0,
        costPerVerifiedListen: 0,
        costPerTransfer: 0,
        costPerConversion: 0,
      },
    ];

    it('should aggregate correctly by state', () => {
      const stateList = aggregateByState(mockPoints);
      expect(stateList.length).toBe(1);
      expect(stateList[0].state).toBe('FL');
      expect(stateList[0].contacted).toBe(30);
      expect(stateList[0].answered).toBe(15);
      expect(stateList[0].spend).toBe(150);
      expect(stateList[0].answerRate).toBe(50); // 15 / 30 * 100
      expect(stateList[0].listenRate).toBe(53.3); // 8 / 15 * 100 -> 53.33 -> 53.3
    });

    it('should aggregate correctly by area code', () => {
      const npaList = aggregateByAreaCode(mockPoints);
      expect(npaList.length).toBe(2);
      const miami = npaList.find(n => n.areaCode === '305');
      const tampa = npaList.find(n => n.areaCode === '813');
      expect(miami?.answered).toBe(5);
      expect(tampa?.answered).toBe(10);
    });
  });
});
