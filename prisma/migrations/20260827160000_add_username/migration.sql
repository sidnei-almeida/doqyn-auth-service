-- O apelido público, e a única coluna de identidade em texto claro.
--
-- O nome é guardado cifrado e o e-mail só tem hash determinístico: nenhum dos dois responde busca
-- por prefixo. Sem esta coluna, achar alguém de outra empresa exigia saber o e-mail exato de
-- antemão, e o diretório nunca ficava navegável.
ALTER TABLE "auth_users" ADD COLUMN "username" TEXT;
ALTER TABLE "auth_users" ADD COLUMN "username_discoverable" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "auth_users_username_key" ON "auth_users"("username");

-- Índice de prefixo com `text_pattern_ops`: o índice padrão de igualdade não serve a `LIKE 'x%'`
-- fora da collation C, e é justamente o prefixo que a busca do diretório faz.
CREATE INDEX "auth_users_username_prefix_idx" ON "auth_users"("username" text_pattern_ops);
