import { describe, expect, it } from 'vitest';

import { brandNotice } from '../services/billing/notifications.js';
import { netEnrollEmailBrand, type EmailBrand } from '../services/email-brand.js';

/**
 * A billing notice's email to a branded agency reads as the agency's product:
 * every "NetEnroll" becomes the brand name, the From name is the brand, and the
 * sign-off is the brand's team. An unbranded agency's copy is left as written.
 */

const BRANDED: EmailBrand = {
  branded: true,
  productName: 'Life Leads Plus',
  logoUrl: 'https://agents.example.test/brands/life-leads-plus/logo.png',
  linkBase: 'https://portal.lifeleadsplus.test',
  from: 'Life Leads Plus <noreply@example.test>',
  signOff: 'The Life Leads Plus team',
};

describe('brandNotice', () => {
  it('renames NetEnroll, signs as the brand and sends from it', () => {
    const notice = brandNotice(
      BRANDED,
      'NetEnroll settlement failed',
      'NetEnroll could not settle Tuesday. Contact NetEnroll.'
    );
    expect(notice.subject).toBe('Life Leads Plus settlement failed');
    expect(notice.body).toBe(
      'Life Leads Plus could not settle Tuesday. Contact Life Leads Plus.\n\nThe Life Leads Plus team'
    );
    expect(notice.from).toBe('Life Leads Plus <noreply@example.test>');
    expect(`${notice.subject}${notice.body}${notice.from}`).not.toContain('NetEnroll');
  });

  it('leaves an unbranded notice as written', () => {
    const notice = brandNotice(netEnrollEmailBrand(), 'NetEnroll notice', 'Body from NetEnroll.');
    expect(notice).toMatchObject({ subject: 'NetEnroll notice', body: 'Body from NetEnroll.' });
  });
});
