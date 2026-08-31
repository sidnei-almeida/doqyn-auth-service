-- Verificação de e-mail por código, sobre a tabela que já existia vazia.
--
-- `auth_email_verifications` nasceu no primeiro schema e nunca foi escrita: o cadastro de empresa
-- carimbava `email_verified = true` direto na conta. Agora ela passa a ser usada, e precisa de
-- três colunas que a versão só-de-link não tinha.

-- Os 6 dígitos, guardados como HMAC de `userId:codigo` — nunca em claro.
ALTER TABLE "auth_email_verifications" ADD COLUMN "code_hash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "auth_email_verifications" ALTER COLUMN "code_hash" DROP DEFAULT;

-- Teto de tentativas por código. Mora na linha, e não em memória, porque reiniciar o processo não
-- pode devolver tentativas a quem está adivinhando um segredo de seis dígitos.
ALTER TABLE "auth_email_verifications" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

-- Quando o e-mail saiu: é desta coluna que o intervalo mínimo entre reenvios se mede.
ALTER TABLE "auth_email_verifications" ADD COLUMN "sent_at" TIMESTAMP(3);

-- A busca do serviço é sempre "a confirmação pendente deste usuário".
CREATE INDEX "auth_email_verifications_user_id_used_at_idx" ON "auth_email_verifications"("user_id", "used_at");
