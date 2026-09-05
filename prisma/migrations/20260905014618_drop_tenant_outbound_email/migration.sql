/*
  Warnings:

  - You are about to drop the `auth_tenant_outbound_email` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "auth_tenant_outbound_email" DROP CONSTRAINT "auth_tenant_outbound_email_tenant_id_fkey";

-- DropTable
DROP TABLE "auth_tenant_outbound_email";
