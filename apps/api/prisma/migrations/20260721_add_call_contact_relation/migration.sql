-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_campaign_calls_contactId_idx" ON "ai_campaign_calls"("contactId");

-- AddForeignKey
ALTER TABLE "ai_campaign_calls" ADD CONSTRAINT "ai_campaign_calls_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "ai_campaign_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
