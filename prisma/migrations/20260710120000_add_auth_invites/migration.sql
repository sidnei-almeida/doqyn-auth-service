-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('pending', 'accepted', 'expired', 'revoked');

-- CreateTable
CREATE TABLE "auth_invites" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email_encrypted" TEXT NOT NULL,
    "email_lookup_hash" TEXT NOT NULL,
    "first_name_encrypted" TEXT,
    "last_name_encrypted" TEXT,
    "invited_by_user_id" UUID NOT NULL,
    "invited_by_membership_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_by_user_id" UUID,
    "accepted_membership_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_invite_roles" (
    "id" UUID NOT NULL,
    "invite_id" UUID NOT NULL,
    "role" "TenantRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_invite_roles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_invites_token_hash_key" ON "auth_invites"("token_hash");

-- CreateIndex
CREATE INDEX "auth_invites_tenant_id_email_lookup_hash_status_idx" ON "auth_invites"("tenant_id", "email_lookup_hash", "status");

-- CreateIndex
CREATE INDEX "auth_invites_tenant_id_status_idx" ON "auth_invites"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "auth_invites_expires_at_idx" ON "auth_invites"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_invite_roles_invite_id_role_key" ON "auth_invite_roles"("invite_id", "role");

-- AddForeignKey
ALTER TABLE "auth_invites" ADD CONSTRAINT "auth_invites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_invites" ADD CONSTRAINT "auth_invites_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_invites" ADD CONSTRAINT "auth_invites_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "auth_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_invite_roles" ADD CONSTRAINT "auth_invite_roles_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "auth_invites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
