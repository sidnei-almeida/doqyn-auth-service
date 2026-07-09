-- CreateTable
CREATE TABLE "auth_oauth_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_subject" TEXT NOT NULL,
    "provider_tenant_id" TEXT,
    "email" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_oauth_accounts_user_id_idx" ON "auth_oauth_accounts"("user_id");

-- CreateIndex
CREATE INDEX "auth_oauth_accounts_email_idx" ON "auth_oauth_accounts"("email");

-- CreateIndex
CREATE INDEX "auth_oauth_accounts_provider_email_idx" ON "auth_oauth_accounts"("provider", "email");

-- CreateIndex
CREATE UNIQUE INDEX "auth_oauth_accounts_provider_provider_subject_key" ON "auth_oauth_accounts"("provider", "provider_subject");

-- AddForeignKey
ALTER TABLE "auth_oauth_accounts" ADD CONSTRAINT "auth_oauth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
