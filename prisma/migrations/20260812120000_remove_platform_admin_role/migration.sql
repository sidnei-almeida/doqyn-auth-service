-- Remove o papel administrativo de plataforma do enum TenantRole.
--
-- Contexto: esse papel existia para dar conveniência de visualização durante o desenvolvimento.
-- Não é um conceito de negócio e não sobrevive ao pré-lançamento. Nenhuma sessão humana volta a
-- ter poder sobre dado de cliente; operação de plataforma passa a exigir chave interna auditada.
--
-- Duas tabelas consomem o enum: auth_membership_roles e auth_invite_roles. Ambas são tratadas.

-- Passo 1 — apagar SOMENTE as linhas de papel com o valor removido.
--
-- Deliberadamente NÃO se apaga a membership nem o convite: contas reais carregam o papel removido
-- junto de `company_admin` e `user`, e apagar a linha-pai tiraria desses usuários o acesso legítimo
-- ao próprio tenant. O DELETE roda nas duas tabelas porque o enum é consumido pelas duas.
DELETE FROM "auth_membership_roles" WHERE "role" = 'doqyn_admin';
DELETE FROM "auth_invite_roles" WHERE "role" = 'doqyn_admin';

-- Passo 1b — nenhuma membership/convite pode ficar sem papel nenhum.
--
-- Uma conta criada só com o papel removido ficaria com zero linhas de papel depois do passo 1. Isso
-- não é bloqueio de acesso limpo: é um estado ambíguo que o verificador de sessão não descreve. O
-- backfill para `user` deixa a conta explicitamente sem privilégio, que é o resultado pretendido.
INSERT INTO "auth_membership_roles" ("id", "membership_id", "role", "created_at")
SELECT gen_random_uuid(), m."id", 'user'::"TenantRole", NOW()
FROM "auth_memberships" m
WHERE NOT EXISTS (
  SELECT 1 FROM "auth_membership_roles" r WHERE r."membership_id" = m."id"
);

INSERT INTO "auth_invite_roles" ("id", "invite_id", "role", "created_at")
SELECT gen_random_uuid(), i."id", 'user'::"TenantRole", NOW()
FROM "auth_invites" i
WHERE NOT EXISTS (
  SELECT 1 FROM "auth_invite_roles" r WHERE r."invite_id" = i."id"
);

-- Passo 2 — recriar o tipo sem o valor.
--
-- O PostgreSQL não remove valor de enum in-place (não existe ALTER TYPE ... DROP VALUE). O caminho
-- suportado é: renomear o tipo antigo, criar o novo, converter cada coluna via texto, dropar o
-- antigo. A conversão só é segura porque o passo 1 já eliminou toda linha que carregava o valor
-- removido — é por isso que o DELETE vem antes, e não depois.
--
-- Os índices únicos (membership_id, role) e (invite_id, role) são reconstruídos automaticamente
-- pelo ALTER COLUMN ... TYPE; não precisam ser recriados à mão.
ALTER TYPE "TenantRole" RENAME TO "TenantRole_old";

CREATE TYPE "TenantRole" AS ENUM ('company_admin', 'individual_admin', 'user');

ALTER TABLE "auth_membership_roles"
  ALTER COLUMN "role" TYPE "TenantRole" USING ("role"::text::"TenantRole");

ALTER TABLE "auth_invite_roles"
  ALTER COLUMN "role" TYPE "TenantRole" USING ("role"::text::"TenantRole");

DROP TYPE "TenantRole_old";
