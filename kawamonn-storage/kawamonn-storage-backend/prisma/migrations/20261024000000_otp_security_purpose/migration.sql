-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('registration', 'admin_login');

-- DropIndex
DROP INDEX "OtpCode_email_idx";

-- AlterTable
ALTER TABLE "OtpCode" DROP COLUMN "code",
ADD COLUMN     "code_hash" VARCHAR(256) NOT NULL,
ADD COLUMN     "consumed_at" TIMESTAMPTZ(6),
ADD COLUMN     "purpose" "OtpPurpose" NOT NULL DEFAULT 'registration';

-- CreateIndex
CREATE INDEX "OtpCode_email_purpose_idx" ON "OtpCode"("email", "purpose");
