-- DropIndex
DROP INDEX "auth_users_username_prefix_idx";

-- CreateTable
CREATE TABLE "auth_invite_access_groups" (
    "id" UUID NOT NULL,
    "invite_id" UUID NOT NULL,
    "access_group_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_invite_access_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_invite_access_groups_access_group_id_idx" ON "auth_invite_access_groups"("access_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_invite_access_groups_invite_id_access_group_id_key" ON "auth_invite_access_groups"("invite_id", "access_group_id");

-- AddForeignKey
ALTER TABLE "auth_invite_access_groups" ADD CONSTRAINT "auth_invite_access_groups_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "auth_invites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_invite_access_groups" ADD CONSTRAINT "auth_invite_access_groups_access_group_id_fkey" FOREIGN KEY ("access_group_id") REFERENCES "auth_access_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
