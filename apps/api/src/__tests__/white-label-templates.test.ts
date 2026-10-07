import { describe, expect, it } from 'vitest';

import { renderDocuments, type DocumentSpec } from '../services/agreements/documents.js';
import {
  documentBrandFor,
  presentIssuer,
  type FrozenIssuer,
} from '../services/agreements/issuer.js';
import { SIG_MARKERS, type RenderOptions } from '../services/agreements/layout.js';
import { getTemplateSet, templateSetFor } from '../services/agreements/template-sets.js';
import type { FrozenTerms } from '../services/agreements/terms.js';

/**
 * Life Leads Plus sends NetEnroll's agreements in its own name: the text is
 * NetEnroll's word for word once the party names and portal are swapped, the
 * documents carry Life Leads Plus's brand, and NetEnroll is named nowhere.
 */

/** Plain text of a rendered document, as agreement-templates.test.ts reads it. */
function plainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<title[\s\S]*?<\/title>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(strong|span|em|b)(\s[^>]*)?>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const LLP: FrozenIssuer = {
  workspaceId: 'w',
  suiteId: 's',
  scope: 'TENANT',
  displayName: 'Life Leads Plus',
  legalEntityName: 'Life Leads Plus LLC',
  dbaName: null,
  noticeAddress: '1 Issuer Way, Tampa, FL 33602',
  noticeEmail: 'contracts@lifeleadsplus.test',
  replyToEmail: null,
  brandTheme: 'life-leads-plus',
  linkOrigin: 'https://agents.lifeleadsplus.com',
  templateSetKey: 'life-leads-plus',
};

const TERMS = {
  agency: {
    legalName: 'Summit Ridge Insurance Group LLC',
    stateEntityType: 'Colorado / Limited Liability Company',
    noticeAddress: '100 Main Street, Suite 4, Denver, CO 80202',
    principalName: 'Dana Whitfield',
    principalTitle: 'Managing Member',
    noticeEmail: 'dana@summitridge.test',
    noticePhone: '(303) 555-0142',
    billingEmail: 'billing@summitridge.test',
    billingPhone: '(303) 555-0199',
  },
  effectiveDate: '2026-10-07',
  msaEffectiveDate: '2026-10-07',
  cpa: {
    verticals: {
      FE: { selected: true, rate: 160, dailyBlock: 5 },
      MEDICARE: { selected: false, rate: 160, dailyBlock: null },
      ACA: { selected: false, rate: 100, dailyBlock: null },
    },
    deliveryDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    deliveryStart: '10:00',
    deliveryEnd: '19:00',
    firstDeliveryDay: null,
  },
  cpl: {
    verticals: {
      FE: { selected: true, rate: 45, bufferSeconds: 120, dailyBlock: 12 },
      MEDICARE: { selected: false, rate: null, bufferSeconds: null, dailyBlock: null },
      ACA: { selected: true, rate: 30.5, bufferSeconds: 90, dailyBlock: 8 },
    },
    deliveryDays: ['MON', 'WED', 'FRI'],
    deliveryStart: '09:00',
    deliveryEnd: '17:30',
    firstDeliveryDay: '2026-10-12',
  },
  netenroll: { noticeAddress: LLP.noticeAddress, noticeEmail: LLP.noticeEmail },
  issuer: LLP,
} as FrozenTerms;

const OPTS: RenderOptions = {
  mode: 'send',
  reference: 'LLP-ABCDEFGH',
  netenrollSignatoryName: 'Pat Owner',
  netenrollSignatoryTitle: 'President',
  netenrollSignedDate: '2026-10-07',
  brand: documentBrandFor(presentIssuer(LLP)),
  issuerPartyLabel: 'LIFE LEADS PLUS LLC',
};

const KINDS = ['MSA', 'CPA', 'CPL'] as const;

function llpSpecs(): Record<(typeof KINDS)[number], DocumentSpec> {
  const set = getTemplateSet('life-leads-plus');
  if (!set?.documents) throw new Error('Life Leads Plus has no templates');
  return set.documents;
}

/** NetEnroll's text with Life Leads Plus named in its place. */
function asLifeLeadsPlus(text: string): string {
  return text
    .replace(
      /PVN LLC, a Florida limited liability company doing business as NetEnroll \("NetEnroll"/g,
      'Life Leads Plus LLC ("Life Leads Plus"'
    )
    .replace(
      /PVN LLC d\/b\/a NetEnroll, a Florida limited liability company/g,
      'Life Leads Plus LLC'
    )
    .replace(/PVN LLC D\/B\/A NETENROLL/g, 'LIFE LEADS PLUS LLC')
    .replace(/NETENROLL (ENTITY|NOTICE)/g, 'LIFE LEADS PLUS $1')
    .replace(/agents\.netenroll\.com/g, 'agents.lifeleadsplus.com')
    .replace(/NetEnroll/g, 'Life Leads Plus');
}

describe('Life Leads Plus agreement suite', () => {
  it('is configured, for Life Leads Plus suites only', () => {
    expect(
      templateSetFor({
        scope: 'TENANT',
        templateSetKey: 'life-leads-plus',
        brandTheme: 'life-leads-plus',
      }).configured
    ).toBe(true);
    expect(
      templateSetFor({
        scope: 'TENANT',
        templateSetKey: 'life-leads-plus',
        brandTheme: 'powerhouse-insurance',
      }).configured
    ).toBe(false);
  });

  it('has its own version strings', () => {
    const specs = llpSpecs();
    expect(KINDS.map(k => specs[k].templateVersion)).toEqual([
      'LLP-MSA-2026-10-07.1',
      'LLP-CPA-2026-10-07.1',
      'LLP-CPL-2026-10-07.1',
    ]);
  });

  const llp = renderDocuments(TERMS, [...KINDS], OPTS, llpSpecs());
  const net = renderDocuments(TERMS, [...KINDS], OPTS);

  for (const [i, kind] of KINDS.entries()) {
    it(`sends NetEnroll's ${kind} word for word, in Life Leads Plus's name`, () => {
      expect(plainText(llp[i].html)).toBe(asLifeLeadsPlus(plainText(net[i].html)));
    });

    it(`never names NetEnroll in the ${kind}`, () => {
      const text = plainText(llp[i].html);
      expect(text).not.toMatch(/NetEnroll|PVN/i);
      expect(text).toContain('Life Leads Plus LLC');
      expect(llp[i].html).not.toContain('alt="NetEnroll"');
    });

    it(`draws the ${kind} in Life Leads Plus's brand`, () => {
      expect(llp[i].html).toContain('alt="Life Leads Plus"');
      expect(llp[i].html).toContain('#0081F1');
      expect(llp[i].html).not.toContain('#10B981');
    });

    it(`carries every signature marker in the ${kind} exactly once`, () => {
      for (const marker of Object.values(SIG_MARKERS)) {
        expect(llp[i].html.split(marker).length - 1, marker).toBe(1);
      }
    });
  }

  it('defines the Portal as agents.lifeleadsplus.com', () => {
    expect(plainText(llp[0].html)).toContain(
      '"Portal" means the Life Leads Plus technology platform at agents.lifeleadsplus.com.'
    );
  });

  it('refuses to render without a legal contracting entity', () => {
    const terms = { ...TERMS, issuer: { ...LLP, legalEntityName: '' } } as FrozenTerms;
    expect(() => renderDocuments(terms, ['MSA'], OPTS, llpSpecs())).toThrow(
      /legal contracting entity/
    );
  });
});
