-- Ameriquote can answer a post with "Lead ID <n> has to be manually approved."
-- That is an acceptance holding for their review, not a failure, but the
-- response parser only knew Matched/Unmatched/Error and recorded it as ERROR.
-- ERROR is re-sendable, so a second run would re-post an already-accepted lead
-- and the buyer would reject it as a 90-day duplicate — permanently unsellable.
ALTER TYPE "InsurancePostStatus" ADD VALUE IF NOT EXISTS 'MANUAL_REVIEW';
