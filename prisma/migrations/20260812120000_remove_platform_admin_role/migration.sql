-- Remove o papel administrativo de plataforma do enum TenantRole.
--
-- Contexto: esse papel existia para dar conveniência de visualização durante o desenvolvimento.
-- Não é um conceito de negócio e não sobrevive ao pré-lançamento. Nenhuma sessão humana volta a
-- ter poder sobre dado de cliente; operação de plataforma passa a exigir chave interna auditada.
--
-- Duas tabelas consomem o enum: auth_membership_roles e auth_invite_roles. Ambas são tratadas.
--
-- A ORDEM DOS TRÊS PASSOS É DELIBERADA E NÃO PODE SER "SIMPLIFICADA":
--   1. backfill ANTES do DELETE, porque só antes dá para saber quais linhas perderiam o último
--      papel — depois do DELETE essa informação já não existe;
--   2. DELETE antes da troca de tipo, porque o cast do passo 3 falha em qualquer linha que ainda
--      carregue o valor removido;
--   3. troca de tipo por último.

-- Passo 1 — preservar quem ficaria sem papel nenhum.
--
-- Uma conta cujo ÚNICO papel é o removido ficaria com zero linhas depois do passo 2. Isso não é
-- bloqueio limpo: é um estado ambíguo que o verificador de sessão não descreve. O backfill para
-- `user` deixa a conta explicitamente sem privilégio, que é o resultado pretendido.
--
-- O predicado casa apenas com "tem o papel removido E não tem nenhum outro". Deliberadamente NÃO
-- se usa "membership sem nenhuma linha de papel": esse predicato mais largo também pegaria contas
-- que já estavam sem papel por outro motivo e lhes concederia `user` — ou seja, acesso ao tenant —
-- sem que esta migração tivesse nada a ver com isso. Em base de desenvolvimento a diferença tende
-- a zero; este arquivo roda em produção depois.
--
-- O ON CONFLICT não deveria disparar nunca: o índice único (membership_id, role) garante no máximo
-- uma linha do papel removido por membership, e o NOT EXISTS já exclui quem tenha `user`. Fica como
-- proteção caso alguém afrouxe o predicado acima no futuro.
INSERT INTO "auth_membership_roles" ("id", "membership_id", "role", "created_at")
SELECT gen_random_uuid(), r."membership_id", 'user'::"TenantRole", NOW()
FROM "auth_membership_roles" r
WHERE r."role" = 'doqyn_admin'
  AND NOT EXISTS (
    SELECT 1
    FROM "auth_membership_roles" o
    WHERE o."membership_id" = r."membership_id"
      AND o."role" <> 'doqyn_admin'
  )
ON CONFLICT ("membership_id", "role") DO NOTHING;

INSERT INTO "auth_invite_roles" ("id", "invite_id", "role", "created_at")
SELECT gen_random_uuid(), r."invite_id", 'user'::"TenantRole", NOW()
FROM "auth_invite_roles" r
WHERE r."role" = 'doqyn_admin'
  AND NOT EXISTS (
    SELECT 1
    FROM "auth_invite_roles" o
    WHERE o."invite_id" = r."invite_id"
      AND o."role" <> 'doqyn_admin'
  )
ON CONFLICT ("invite_id", "role") DO NOTHING;

-- Passo 2 — apagar SOMENTE as linhas de papel com o valor removido.
--
-- Deliberadamente NÃO se apaga a membership nem o convite: contas reais carregam o papel removido
-- junto de `company_admin` e `user`, e apagar a linha-pai tiraria desses usuários o acesso legítimo
-- ao próprio tenant. O DELETE roda nas duas tabelas porque o enum é consumido pelas duas.
DELETE FROM "auth_membership_roles" WHERE "role" = 'doqyn_admin';
DELETE FROM "auth_invite_roles" WHERE "role" = 'doqyn_admin';

-- Passo 3 — recriar o tipo sem o valor.
--
-- O PostgreSQL não remove valor de enum in-place (não existe ALTER TYPE ... DROP VALUE). O caminho
-- suportado é: renomear o tipo antigo, criar o novo, converter cada coluna via texto, dropar o
-- antigo. A conversão só é segura porque o passo 2 já eliminou toda linha que carregava o valor
-- removido.
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
