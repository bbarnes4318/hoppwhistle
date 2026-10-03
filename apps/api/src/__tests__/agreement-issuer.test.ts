import type { AgreementEnvelope } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { renderCertificate } from '../services/agreements/certificate.js';
import {
  documentBrandFor,
  issuerOfEnvelope,
  presentIssuer,
  type FrozenIssuer,
} from '../services/agreements/issuer.js';
import { documentFooterTemplate } from '../services/agreements/pdf.js';

/**
 * The issuer of a document comes from the document. These run without a
 * database: the certificate and PDF frame of a white-label agreement name the
 * white-label issuer and never NetEnroll, and a pre-suite envelope still reads
 * as NetEnroll's exactly as before.
 */

const LLP: FrozenIssuer = {
  workspaceId: 'w',
  suiteId: 's',
  scope: 'TENANT',
  displayName: 'Life Leads Plus',
  legalEntityName: 'Life Leads Plus LLC',
  dbaName: null,
  noticeAddress: '1 Issuer Way',
  noticeEmail: 'contracts@lifeleadsplus.test',
  replyToEmail: null,
  brandTheme: 'life-leads-plus',
  linkOrigin: 'https://agents.lifeleadsplus.com',
  templateSetKey: 'life-leads-plus',
};

function envelope(terms: Record<string, unknown>, issuerSigned: boolean): AgreementEnvelope {
  return {
    id: 'e',
    reference: issuerSigned ? 'LLP-ABCDEFGH' : 'NE-ABCDEFGH',
    terms,
    signerName: 'Riley Agent',
    signerTitle: 'Individually',
    signerEmail: 'riley@abc.test',
    ccEmails: [],
    signerTypedSignature: 'Riley Agent',
    signerInitials: 'RA',
    signatureMethod: 'TYPED',
    netenrollSignatoryName: issuerSigned ? null : 'James Kelly',
    netenrollSignatoryTitle: issuerSigned ? null : 'Managing Partner',
    netenrollSignedByUserId: issuerSigned ? null : 'u',
    netenrollSignedAt: issuerSigned ? null : new Date('2026-10-03T12:00:00Z'),
    netenrollSignedIp: null,
    issuerSignatoryName: issuerSigned ? 'Pat Owner' : null,
    issuerSignatoryTitle: issuerSigned ? 'President' : null,
    issuerSignedByUserId: issuerSigned ? 'u' : null,
    issuerSignedAt: issuerSigned ? new Date('2026-10-03T12:00:00Z') : null,
    issuerSignedIp: null,
    signedAt: new Date('2026-10-04T12:00:00Z'),
    consentedAt: new Date('2026-10-04T11:00:00Z'),
  } as unknown as AgreementEnvelope;
}

function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ');
}

function certificateFor(env: AgreementEnvelope): string {
  const issuer = issuerOfEnvelope(env);
  return renderCertificate({
    portalUrl: issuer.linkOrigin,
    envelope: env,
    document: {
      id: 'd',
      title: 'Fixture MSA',
      templateVersion: 'X-1',
      sentHtmlSha256: 'a'.repeat(64),
    },
    contentSha256: 'b'.repeat(64),
    contentPageCount: 3,
    completedAt: new Date('2026-10-04T12:01:00Z'),
    agencyLegalName: 'ABC Insurance Agency',
    drawnPngDataUri: null,
    netenrollAdminEmail: 'owner@lifeleadsplus.test',
    internalCopyEmails: [],
    events: [],
    issuer,
    brand: documentBrandFor(issuer),
  });
}

describe('issuer on the executed document', () => {
  it('prints a white-label certificate in the issuer’s name and brand, never NetEnroll’s', () => {
    const html = certificateFor(
      envelope({ netenroll: { noticeEmail: LLP.noticeEmail }, issuer: LLP }, true)
    );
    const text = visibleText(html);
    expect(text).toContain('LIFE LEADS PLUS LLC · ELECTRONIC SIGNATURE RECORD');
    expect(text).toContain('Pat Owner');
    expect(text).toContain('https://agents.lifeleadsplus.com/agreements/verify');
    expect(text).not.toMatch(/NetEnroll/i);
    expect(html).toContain('alt="Life Leads Plus"');
    expect(html).toContain('#0081F1');
  });

  it('prints a pre-suite envelope’s certificate as NetEnroll’s, as before', () => {
    const html = certificateFor(
      envelope({ netenroll: { noticeEmail: 'support@pvnvoice.com' } }, false)
    );
    expect(visibleText(html)).toContain('PVN LLC D/B/A NETENROLL · ELECTRONIC SIGNATURE RECORD');
    expect(visibleText(html)).toContain('James Kelly');
    expect(html).toContain('alt="NetEnroll"');
  });

  it('names the issuer in the page footer', () => {
    expect(documentFooterTemplate('LLP-1', 'RA', 'Life Leads Plus LLC')).toContain(
      'Life Leads Plus LLC · Confidential'
    );
    expect(documentFooterTemplate('NE-1', 'RA')).toContain(
      'PVN LLC d/b/a NetEnroll · Confidential'
    );
  });

  it('never gives a theme-less white-label issuer NetEnroll’s logo', () => {
    const brand = documentBrandFor(presentIssuer({ ...LLP, brandTheme: null }));
    expect(brand.key).toBe('neutral');
    expect(brand.logoDataUri).toBeNull();
  });
});
