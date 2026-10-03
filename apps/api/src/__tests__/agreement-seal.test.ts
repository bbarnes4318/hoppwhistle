import forge from 'node-forge';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { mergePdfs, sealConfig, sealPdf } from '../services/agreements/pdf.js';

/**
 * The document seal: a PKCS#7 signature over the merged PDF with the
 * PVN LLC seal certificate. A throwaway certificate is generated here, in the
 * shape docs/AGREEMENTS.md tells an operator to make.
 */

function throwawayP12(passphrase: string): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const attrs = [
    { name: 'commonName', value: 'PVN LLC d/b/a NetEnroll Document Seal' },
    { name: 'organizationName', value: 'PVN LLC' },
    { name: 'countryName', value: 'US' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
}

async function onePagePdf(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage().drawText(text);
  return Buffer.from(await doc.save());
}

describe('the agreement seal', () => {
  it('reads nothing from an empty environment', () => {
    const saved = process.env.AGREEMENT_SEAL_P12_BASE64;
    delete process.env.AGREEMENT_SEAL_P12_BASE64;
    expect(sealConfig()).toBeNull();
    if (saved !== undefined) process.env.AGREEMENT_SEAL_P12_BASE64 = saved;
  });

  it('merges with metadata and signs the result', async () => {
    const merged = await mergePdfs(await onePagePdf('content'), await onePagePdf('certificate'), {
      title: 'CPA Agreement — Summit Ridge LLC',
      author: 'PVN LLC d/b/a NetEnroll',
      subject: 'Executed agreement NE-TEST2345',
      keywords: ['NE-TEST2345'],
      creator: 'NetEnroll Agreements',
      creationDate: new Date('2026-10-03T12:00:00Z'),
    });
    const parsed = await PDFDocument.load(merged);
    expect(parsed.getPageCount()).toBe(2);
    expect(parsed.getAuthor()).toBe('PVN LLC d/b/a NetEnroll');
    expect(parsed.getSubject()).toBe('Executed agreement NE-TEST2345');

    const sealed = await sealPdf(
      merged,
      { p12: throwawayP12('pass'), passphrase: 'pass' },
      {
        reason: 'Executed agreement NE-TEST2345',
        location: 'Saint Augustine, Florida',
        contactInfo: 'support@pvnvoice.com',
        name: 'PVN LLC d/b/a NetEnroll',
        signingTime: new Date('2026-10-03T12:00:00Z'),
      }
    );
    const text = sealed.toString('latin1');
    expect(text).toContain('/ByteRange');
    expect(text).toContain('adbe.pkcs7.detached');
    expect(text).toContain('Saint Augustine, Florida');
    // The placeholder was replaced by a real signature, not left as zeros.
    const contents = /\/Contents\s*<([0-9a-fA-F]+)>/.exec(text)?.[1] ?? '';
    expect(contents.replace(/0/g, '').length).toBeGreaterThan(100);
    expect((await PDFDocument.load(sealed)).getPageCount()).toBe(2);
  }, 60_000);
});
