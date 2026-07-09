-- CreateEnum
CREATE TYPE "TermsAcceptanceFlow" AS ENUM ('company_registration', 'access_request', 'individual_registration', 'reacceptance');

-- CreateTable
CREATE TABLE "auth_terms_acceptances" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "membership_id" UUID,
    "tenant_id" UUID,
    "access_request_id" UUID,
    "flow" "TermsAcceptanceFlow" NOT NULL,
    "terms_version" TEXT NOT NULL,
    "privacy_version" TEXT,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address_hash" TEXT,
    "user_agent_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_terms_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_terms_acceptances_user_id_idx" ON "auth_terms_acceptances"("user_id");

-- CreateIndex
CREATE INDEX "auth_terms_acceptances_membership_id_idx" ON "auth_terms_acceptances"("membership_id");

-- CreateIndex
CREATE INDEX "auth_terms_acceptances_tenant_id_idx" ON "auth_terms_acceptances"("tenant_id");

-- CreateIndex
CREATE INDEX "auth_terms_acceptances_access_request_id_idx" ON "auth_terms_acceptances"("access_request_id");

-- CreateIndex
CREATE INDEX "auth_terms_acceptances_flow_idx" ON "auth_terms_acceptances"("flow");

-- AddForeignKey
ALTER TABLE "auth_terms_acceptances" ADD CONSTRAINT "auth_terms_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_terms_acceptances" ADD CONSTRAINT "auth_terms_acceptances_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "auth_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_terms_acceptances" ADD CONSTRAINT "auth_terms_acceptances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth_tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_terms_acceptances" ADD CONSTRAINT "auth_terms_acceptances_access_request_id_fkey" FOREIGN KEY ("access_request_id") REFERENCES "auth_access_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
