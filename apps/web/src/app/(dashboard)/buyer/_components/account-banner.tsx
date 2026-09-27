import Link from 'next/link';
import * as React from 'react';

import { Notice } from '@/components/domain';
import { settle } from '@/lib/server/api';
import { fetchBuyerProfile, type BuyerProfile } from '@/lib/server/buyer';
import { getSession } from '@/lib/server/session';
import { formatCurrency } from '@/lib/utils';

/**
 * The account's state, above every buyer page.
 *
 * A paused buyer receives no calls, and the first place that shows is a call
 * list that has gone quiet -- which reads as a slow day, not as an account that
 * is switched off. So the pause is said at the top of every page, with the one
 * thing that differs between the two kinds of pause: who can lift it.
 *
 *   WALLET_EMPTY  "Paused: balance too low". Topping up resumes the account on
 *                 its own, so the notice points at the top-up.
 *   MANUAL        "Paused by <agency>". A top-up does NOT resume it; the agency
 *                 paused it and only the agency can resume it, and saying so
 *                 saves the buyer paying in to fix something money cannot.
 *
 * A prepaid account that is not paused but is running low gets a warning
 * instead, so the first pause is not the first the buyer hears of it. Both
 * decisions are the API's (`pauseReason`, `lowBalance` on the buyer profile);
 * this only words them.
 */

export type AccountNoticeProfile = Pick<
  BuyerProfile,
  'status' | 'pauseReason' | 'pausedBy' | 'billingType' | 'walletBalance' | 'lowBalance'
>;

/** The notice for a profile, or null when there is nothing to say. */
export function AccountNotice({ profile }: { profile: AccountNoticeProfile }) {
  const billingLink = (
    <Link href="/buyer/billing" className="t-body text-money underline">
      Go to billing
    </Link>
  );

  if (profile.status === 'PAUSED') {
    if (profile.pauseReason === 'WALLET_EMPTY') {
      return (
        <Notice tone="error" title="Paused: balance too low" action={billingLink}>
          Calls stop being routed to you until your balance is topped up. Once it is, your account
          resumes on its own.
        </Notice>
      );
    }

    // MANUAL, and a paused account whose reason the API did not send: either
    // way it is not one a top-up will lift.
    const by = profile.pausedBy ?? 'your account manager';
    return (
      <Notice tone="error" title={`Paused by ${by}`}>
        Calls are not being routed to you. Adding funds will not resume your account — contact {by}{' '}
        to have it turned back on.
      </Notice>
    );
  }

  const low = profile.lowBalance;
  if (profile.billingType === 'UPFRONT' && low?.isLow && low.averageCallPrice != null) {
    return (
      <Notice tone="warning" title="Balance running low" action={billingLink}>
        Your balance of {formatCurrency(profile.walletBalance)} covers fewer than five calls at
        about {formatCurrency(low.averageCallPrice)} each. When it runs out, calls stop being routed
        to you.
      </Notice>
    );
  }

  return null;
}

/**
 * The layout's loader for the notice. It reads the session itself rather than
 * through `requireBuyerScope`: the page below does the gating and the
 * redirecting, and a banner that could redirect would do it twice. No buyer,
 * or a profile that did not load, is no banner -- the page's own panels say
 * what failed.
 */
export async function AccountBanner() {
  const session = await getSession();
  const buyerId = session?.user.buyerId;
  if (!session || !buyerId) return null;

  const { data } = await settle(fetchBuyerProfile(session.token, buyerId));
  if (!data) return null;

  return <AccountNotice profile={data} />;
}
