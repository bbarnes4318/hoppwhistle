-- CreateEnum
CREATE TYPE "CarrierAutomationStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "insurance_carrier_applications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "insuranceLeadId" TEXT,
    "prospectIntakeId" TEXT,
    "callId" TEXT,
    "carrier" TEXT NOT NULL DEFAULT 'American Amicable',
    "product" TEXT NOT NULL DEFAULT 'Senior Choice',
    "planType" TEXT,
    "monthlyPremium" DECIMAL(10,2),
    "faceAmount" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "dob" TEXT,
    "age" INTEGER,
    "gender" TEXT,
    "tobacco" BOOLEAN NOT NULL DEFAULT false,
    "stateOfBirth" TEXT,
    "heightFeet" INTEGER,
    "heightInches" INTEGER,
    "weight" INTEGER,
    "ssnEncrypted" TEXT,
    "ssnLast4" TEXT,
    "routingNumberEncrypted" TEXT,
    "routingNumberLast4" TEXT,
    "accountNumberEncrypted" TEXT,
    "accountNumberLast4" TEXT,
    "accountHolder" TEXT,
    "accountType" TEXT,
    "bankName" TEXT,
    "bankCityState" TEXT,
    "draftSchedule" TEXT,
    "draftDay" TEXT,
    "beneficiaryName" TEXT,
    "beneficiaryRelation" TEXT,
    "contingentBeneficiaryName" TEXT,
    "contingentBeneficiaryRelation" TEXT,
    "ownerIsInsured" BOOLEAN NOT NULL DEFAULT true,
    "payorIsInsured" BOOLEAN NOT NULL DEFAULT true,
    "ownerName" TEXT,
    "ownerRelation" TEXT,
    "ownerAddress" TEXT,
    "hasExistingInsurance" BOOLEAN NOT NULL DEFAULT false,
    "willReplaceExisting" BOOLEAN NOT NULL DEFAULT false,
    "existingCompanyName" TEXT,
    "existingPolicyNumber" TEXT,
    "existingCoverageAmount" TEXT,
    "doctorName" TEXT,
    "doctorAddress" TEXT,
    "doctorPhone" TEXT,
    "healthQ1" BOOLEAN NOT NULL DEFAULT false,
    "healthQ2" BOOLEAN NOT NULL DEFAULT false,
    "healthQ3" BOOLEAN NOT NULL DEFAULT false,
    "healthQ4" BOOLEAN NOT NULL DEFAULT false,
    "healthQ5" BOOLEAN NOT NULL DEFAULT false,
    "healthQ6" BOOLEAN NOT NULL DEFAULT false,
    "healthQ7a" BOOLEAN NOT NULL DEFAULT false,
    "healthQ7b" BOOLEAN NOT NULL DEFAULT false,
    "healthQ7c" BOOLEAN NOT NULL DEFAULT false,
    "healthQ7d" BOOLEAN NOT NULL DEFAULT false,
    "healthQ8a" BOOLEAN NOT NULL DEFAULT false,
    "healthQ8b" BOOLEAN NOT NULL DEFAULT false,
    "healthQ8c" BOOLEAN NOT NULL DEFAULT false,
    "healthCovid" BOOLEAN NOT NULL DEFAULT false,
    "ilDesigneeChoice" TEXT,
    "carrierApplicationNumber" TEXT,
    "automationJobId" TEXT,
    "automationStatus" "CarrierAutomationStatus" NOT NULL DEFAULT 'PENDING',
    "automationError" TEXT,
    "automationStartedAt" TIMESTAMP(3),
    "automationCompletedAt" TIMESTAMP(3),
    "lastDebugSnapshotPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "insurance_carrier_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "insurance_carrier_applications_automationJobId_key" ON "insurance_carrier_applications"("automationJobId");

-- CreateIndex
CREATE INDEX "insurance_carrier_applications_tenantId_idx" ON "insurance_carrier_applications"("tenantId");

-- CreateIndex
CREATE INDEX "insurance_carrier_applications_tenantId_phone_idx" ON "insurance_carrier_applications"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "insurance_carrier_applications_tenantId_createdAt_idx" ON "insurance_carrier_applications"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "insurance_carrier_applications_prospectIntakeId_idx" ON "insurance_carrier_applications"("prospectIntakeId");

-- CreateIndex
CREATE INDEX "insurance_carrier_applications_insuranceLeadId_idx" ON "insurance_carrier_applications"("insuranceLeadId");

-- CreateIndex
CREATE INDEX "insurance_carrier_applications_callId_idx" ON "insurance_carrier_applications"("callId");

