-- O pedido de acesso sai inteiro.
--
-- Quem entra numa empresa entra convidado: alguém de dentro emite o link, e o convite é a
-- aprovação. Sem o pedido não há fila, e sem fila a tabela guardava só um caminho que ninguém
-- percorre mais.
--
-- `auth_terms_acceptances.access_request_id` cai junto — apontava para linhas que deixam de
-- existir. O valor `access_request` do enum `TermsAcceptanceFlow` **fica**: rotula aceites que
-- já aconteceram, e apagá-lo do enum quebraria a leitura das linhas que o carregam.

-- DropForeignKey
ALTER TABLE "auth_terms_acceptances" DROP CONSTRAINT IF EXISTS "auth_terms_acceptances_access_request_id_fkey";

-- DropIndex
DROP INDEX IF EXISTS "auth_terms_acceptances_access_request_id_idx";

-- AlterTable
ALTER TABLE "auth_terms_acceptances" DROP COLUMN IF EXISTS "access_request_id";

-- DropTable
DROP TABLE IF EXISTS "auth_access_requests";

-- DropEnum
DROP TYPE IF EXISTS "AccessRequestStatus";
