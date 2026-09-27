/**
 * Whether a `POST /api/v1/post` answer means the call was accepted.
 *
 * The API answers `{ status, accepted, transfer_number, ping_id }` (see
 * `apps/api/src/services/post-service.ts`). The tester used to look for
 * `status === 'LEASED'` and a `leased_number`, neither of which the API has
 * ever sent, so every successful post read as a failure. Success is
 * `accepted === true` with a number to send the caller to: an acceptance with
 * no number leaves the publisher nothing to dial, which is not a success.
 */
export interface PostAnswer {
  accepted: true;
  transferNumber: string;
}

export function acceptedPost(body: unknown): PostAnswer | null {
  if (!body || typeof body !== 'object') return null;
  const { accepted, transfer_number: transferNumber } = body as Record<string, unknown>;
  if (accepted !== true) return null;
  if (typeof transferNumber !== 'string' || transferNumber.trim() === '') return null;
  return { accepted: true, transferNumber };
}
