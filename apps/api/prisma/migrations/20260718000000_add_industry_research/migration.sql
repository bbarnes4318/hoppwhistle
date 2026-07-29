-- Industry Research pipeline (additive, tenant-isolated). No changes to existing
-- tables/columns/enums. Safe to roll back by dropping these four tables.

-- CreateTable
CREATE TABLE "research_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "researchBriefId" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "geography" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "brief" JSONB NOT NULL,
    "providerAssignments" JSONB NOT NULL,
    "costEstimate" JSONB NOT NULL,
    "plan" JSONB,
    "progress" JSONB,
    "maxBudgetUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "accruedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "verdict" TEXT,
    "overallScore" INTEGER,
    "insufficientEvidence" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_stages" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stageKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "role" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sourcesFound" INTEGER,
    "searches" INTEGER,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "usedFallback" BOOLEAN NOT NULL DEFAULT false,
    "output" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_reports" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "verdict" TEXT,
    "overallScore" INTEGER,
    "markdown" TEXT NOT NULL,
    "structured" JSONB NOT NULL,
    "evidence" JSONB,
    "sources" JSONB,
    "verification" JSONB,
    "synthesisProvider" TEXT,
    "synthesisModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_team_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_team_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "research_runs_tenantId_status_idx" ON "research_runs"("tenantId", "status");
CREATE INDEX "research_runs_tenantId_createdAt_idx" ON "research_runs"("tenantId", "createdAt");
CREATE INDEX "research_runs_tenantId_industry_idx" ON "research_runs"("tenantId", "industry");
CREATE INDEX "research_runs_status_idx" ON "research_runs"("status");

CREATE INDEX "research_stages_runId_idx" ON "research_stages"("runId");
CREATE INDEX "research_stages_runId_stageKey_idx" ON "research_stages"("runId", "stageKey");

CREATE INDEX "research_reports_runId_idx" ON "research_reports"("runId");
CREATE INDEX "research_reports_tenantId_createdAt_idx" ON "research_reports"("tenantId", "createdAt");
CREATE INDEX "research_reports_runId_version_idx" ON "research_reports"("runId", "version");

CREATE INDEX "research_team_profiles_tenantId_idx" ON "research_team_profiles"("tenantId");
CREATE INDEX "research_team_profiles_tenantId_createdAt_idx" ON "research_team_profiles"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "research_stages" ADD CONSTRAINT "research_stages_runId_fkey" FOREIGN KEY ("runId") REFERENCES "research_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_reports" ADD CONSTRAINT "research_reports_runId_fkey" FOREIGN KEY ("runId") REFERENCES "research_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
