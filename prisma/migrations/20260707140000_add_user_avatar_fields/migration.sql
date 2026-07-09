-- Avatar de perfil (metadados; blob no R2 via app principal)
ALTER TABLE "auth_users"
  ADD COLUMN IF NOT EXISTS "avatar_storage_provider" TEXT,
  ADD COLUMN IF NOT EXISTS "avatar_object_key" TEXT,
  ADD COLUMN IF NOT EXISTS "avatar_content_type" TEXT,
  ADD COLUMN IF NOT EXISTS "avatar_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "avatar_updated_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "avatar_size" INTEGER,
  ADD COLUMN IF NOT EXISTS "avatar_status" TEXT;
