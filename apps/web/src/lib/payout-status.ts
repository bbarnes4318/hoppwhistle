/**
 * A publisher payout's status, as the screens name it.
 *
 * CLAWED_BACK is a call whose buyer's return was accepted after the publisher
 * had been paid for it: the payout was taken back, and comes out of that
 * publisher's next payment (apps/api/src/routes/returns.ts).
 */
export const CLAWED_BACK = 'CLAWED_BACK';

export const CLAWED_BACK_LABEL = 'Returned, deducted from next payment';

/** The Badge classes for a clawed-back payout: the `dropped` tone family. */
export const CLAWED_BACK_BADGE = 'bg-dropped-tint text-dropped-ink border-dropped/40';
