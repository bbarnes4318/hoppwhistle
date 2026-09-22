/**
 * The canonical dispositions, and how they read on screen.
 *
 * The list mirrors `VALID_DISPOSITIONS` in `apps/api/src/routes/index.ts`,
 * which is what the write path enforces. It lives here rather than inside a
 * page because three screens need it now -- the ledger renders it, the ledger's
 * filter offers it, and the re-disposition panel picks from it -- and three
 * copies of a list the API validates against is three chances to drift.
 *
 * Anything not in the map renders verbatim rather than being hidden: a value
 * the API accepted and this has not caught up with is still the truth about
 * that call, and blanking it would make the screen quietly disagree with the
 * database.
 */
export const DISPOSITION_LABELS: Record<string, string> = {
  APPLICATION_SUBMITTED: 'Application submitted',
  LIVE_TRANSFER: 'Live transfer',
  SET_APPOINTMENT: 'Appointment set',
  SET_CALLBACK: 'Callback set',
  FOLLOW_UP: 'Follow up',
  VERIFIED: 'Verified',
  NOT_INTERESTED: 'Not interested',
  NOT_QUALIFIED: 'Not qualified',
  NO_MEMORY_CONFUSED: 'No memory / confused',
  WRONG_NUMBER: 'Wrong number',
  NO_ANSWER: 'No answer',
  DISCONNECTED: 'Disconnected',
};
