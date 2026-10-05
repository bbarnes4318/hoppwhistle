-- FEX quote engine: saved quotes, per-agency quoter settings, and the link
-- from a submitted application to the quote it was written from.

CREATE TABLE IF NOT EXISTS "fex_quotes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "callId" TEXT,
    "insuranceLeadId" TEXT,
    "engineVersion" TEXT NOT NULL,
    "bundleSha256" TEXT NOT NULL,
    "prospectName" TEXT,
    "state" TEXT NOT NULL,
    "age" INTEGER,
    "sex" TEXT NOT NULL,
    "tobacco" BOOLEAN NOT NULL,
    "faceAmount" INTEGER,
    "budget" DECIMAL(10,2),
    "paymentMode" TEXT NOT NULL,
    "eligibleCount" INTEGER NOT NULL,
    "lowestPremium" DECIMAL(10,2),
    "selectedProductId" TEXT,
    "selectedCarrier" TEXT,
    "selectedProduct" TEXT,
    "selectedClass" TEXT,
    "selectedBenefit" TEXT,
    "selectedFace" INTEGER,
    "selectedPremium" DECIMAL(10,2),
    "applicantEncrypted" TEXT NOT NULL,
    "resultsEncrypted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fex_quotes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "fex_quotes_tenantId_createdAt_idx" ON "fex_quotes"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "fex_quotes_tenantId_createdById_createdAt_idx" ON "fex_quotes"("tenantId", "createdById", "createdAt");
CREATE INDEX IF NOT EXISTS "fex_quotes_tenantId_callId_idx" ON "fex_quotes"("tenantId", "callId");
CREATE INDEX IF NOT EXISTS "fex_quotes_tenantId_insuranceLeadId_idx" ON "fex_quotes"("tenantId", "insuranceLeadId");

DO $$ BEGIN
  ALTER TABLE "fex_quotes" ADD CONSTRAINT "fex_quotes_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "fex_quotes" ADD CONSTRAINT "fex_quotes_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "fex_tenant_settings" (
    "tenantId" TEXT NOT NULL,
    "appointedOnly" BOOLEAN NOT NULL DEFAULT false,
    "appointedProductIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultFace" INTEGER NOT NULL DEFAULT 10000,
    "defaultMode" TEXT NOT NULL DEFAULT 'monthly',
    "showPriceOnly" BOOLEAN NOT NULL DEFAULT true,
    "autoOpenOnCall" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fex_tenant_settings_pkey" PRIMARY KEY ("tenantId")
);

DO $$ BEGIN
  ALTER TABLE "fex_tenant_settings" ADD CONSTRAINT "fex_tenant_settings_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "insurance_carrier_applications" ADD COLUMN IF NOT EXISTS "fexQuoteId" TEXT;
CREATE INDEX IF NOT EXISTS "insurance_carrier_applications_tenantId_fexQuoteId_idx"
  ON "insurance_carrier_applications"("tenantId", "fexQuoteId");
