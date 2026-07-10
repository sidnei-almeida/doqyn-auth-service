-- CreateTable
CREATE TABLE "auth_tenant_outbound_email" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "smtp_host" TEXT NOT NULL,
    "smtp_port" INTEGER NOT NULL DEFAULT 587,
    "smtp_secure" BOOLEAN NOT NULL DEFAULT false,
    "smtp_user_encrypted" TEXT NOT NULL,
    "smtp_password_encrypted" TEXT NOT NULL,
    "from_domain" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_tenant_outbound_email_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_tenant_outbound_email_tenant_id_key" ON "auth_tenant_outbound_email"("tenant_id");

-- AddForeignKey
ALTER TABLE "auth_tenant_outbound_email" ADD CONSTRAINT "auth_tenant_outbound_email_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
