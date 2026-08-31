-- Dois prazos por linha, e a troca de e-mail ganha código.
--
-- Código e link não valem o mesmo: seis dígitos são um segredo pequeno e precisam de janela curta,
-- 32 bytes aleatórios não se adivinham e podem esperar quem só abre o e-mail à noite. Com um
-- prazo só, escolher os 15 minutos do código tornava o link inútil, e escolher as 24 horas do
-- link afrouxava o código. Daí a segunda coluna.

-- Confirmação de cadastro: o link volta a durar `EMAIL_VERIFICATION_TTL_HOURS`.
ALTER TABLE "auth_email_verifications" ADD COLUMN "token_expires_at" TIMESTAMP(3);
UPDATE "auth_email_verifications" SET "token_expires_at" = "expires_at" WHERE "token_expires_at" IS NULL;
ALTER TABLE "auth_email_verifications" ALTER COLUMN "token_expires_at" SET NOT NULL;

-- Troca de endereço: as mesmas colunas da confirmação de cadastro, pelo mesmo motivo. O fluxo
-- vinha só com link, e quem lê o e-mail no celular tinha de voltar ao computador sem nada na mão.
ALTER TABLE "auth_email_changes" ADD COLUMN "code_hash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "auth_email_changes" ALTER COLUMN "code_hash" DROP DEFAULT;
ALTER TABLE "auth_email_changes" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "auth_email_changes" ADD COLUMN "sent_at" TIMESTAMP(3);
ALTER TABLE "auth_email_changes" ADD COLUMN "token_expires_at" TIMESTAMP(3);
UPDATE "auth_email_changes" SET "token_expires_at" = "expires_at" WHERE "token_expires_at" IS NULL;
ALTER TABLE "auth_email_changes" ALTER COLUMN "token_expires_at" SET NOT NULL;

-- As trocas pendentes de antes só têm link, e `code_hash` vazio nunca casa com HMAC nenhum.
-- Encerrá-las é mais honesto que deixar a pessoa digitar um código que não existe: ela pede outra.
UPDATE "auth_email_changes" SET "used_at" = NOW() WHERE "used_at" IS NULL;
