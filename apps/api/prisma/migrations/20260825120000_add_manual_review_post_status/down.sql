-- Postgres cannot drop a value from an enum in place. Reverting means moving
-- the affected rows off the value first; they are accepted leads, so ERROR
-- would misrepresent them and re-expose them to being re-sent. UNMATCHED is
-- the closest non-resendable-by-accident meaning, but review before running.
UPDATE "insurance_lead_submissions" SET "postStatus" = 'UNMATCHED'
  WHERE "postStatus" = 'MANUAL_REVIEW';
