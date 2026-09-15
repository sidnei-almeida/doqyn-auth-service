-- AlterTable
ALTER TABLE "auth_invites" ADD COLUMN     "locale" VARCHAR(10) NOT NULL DEFAULT 'pt-BR';

-- AlterTable
ALTER TABLE "auth_tenants" ADD COLUMN     "default_locale" VARCHAR(10) NOT NULL DEFAULT 'pt-BR';

-- AlterTable
ALTER TABLE "auth_terms_acceptances" ADD COLUMN     "locale" VARCHAR(10) NOT NULL DEFAULT 'pt-BR';

-- AlterTable
ALTER TABLE "auth_users" ADD COLUMN     "locale" VARCHAR(10) NOT NULL DEFAULT 'pt-BR',
ADD COLUMN     "time_zone" VARCHAR(64);
