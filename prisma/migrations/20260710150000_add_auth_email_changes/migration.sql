-- CreateTable
CREATE TABLE "auth_email_changes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "new_email_encrypted" TEXT NOT NULL,
    "new_email_lookup_hash" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_email_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_email_changes_token_hash_key" ON "auth_email_changes"("token_hash");

-- CreateIndex
CREATE INDEX "auth_email_changes_user_id_used_at_idx" ON "auth_email_changes"("user_id", "used_at");

-- CreateIndex
CREATE INDEX "auth_email_changes_new_email_lookup_hash_idx" ON "auth_email_changes"("new_email_lookup_hash");

-- AddForeignKey
ALTER TABLE "auth_email_changes" ADD CONSTRAINT "auth_email_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
