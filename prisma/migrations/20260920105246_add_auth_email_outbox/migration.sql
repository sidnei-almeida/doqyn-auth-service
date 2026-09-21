-- CreateEnum
CREATE TYPE "AuthEmailOutboxPurpose" AS ENUM ('email_verification', 'password_reset', 'email_change', 'invite');

-- CreateEnum
CREATE TYPE "AuthEmailOutboxStatus" AS ENUM ('queued', 'sending', 'sent', 'failed');

-- CreateTable
CREATE TABLE "auth_email_outbox" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "purpose" "AuthEmailOutboxPurpose" NOT NULL,
    "to_encrypted" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "from_name" TEXT,
    "from_email" TEXT,
    "reply_to_name" TEXT,
    "reply_to_email" TEXT,
    "status" "AuthEmailOutboxStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "locked_at" TIMESTAMP(3),
    "provider_message_id" TEXT,
    "failure_reason" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_email_outbox_status_next_attempt_at_idx" ON "auth_email_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "auth_email_outbox_user_id_idx" ON "auth_email_outbox"("user_id");

-- AddForeignKey
ALTER TABLE "auth_email_outbox" ADD CONSTRAINT "auth_email_outbox_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
