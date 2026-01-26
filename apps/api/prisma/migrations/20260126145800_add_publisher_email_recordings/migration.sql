-- AlterTable
ALTER TABLE "publishers" ADD COLUMN     "email" TEXT,
ADD COLUMN     "accessToRecordings" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "publishers_email_key" ON "publishers"("email");

-- CreateIndex
CREATE INDEX "publishers_email_idx" ON "publishers"("email");
