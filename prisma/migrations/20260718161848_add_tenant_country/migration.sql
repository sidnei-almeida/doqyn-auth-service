-- AlterTable
ALTER TABLE "auth_tenants" ADD COLUMN     "country" VARCHAR(2);

-- CreateIndex
CREATE INDEX "auth_tenants_country_idx" ON "auth_tenants"("country");
