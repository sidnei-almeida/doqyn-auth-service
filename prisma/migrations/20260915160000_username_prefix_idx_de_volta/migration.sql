-- Recria o índice de prefixo do handle.
--
-- `20260827160000_add_username` o criou à mão (o Prisma não declara `text_pattern_ops`), e o
-- `migrate dev` de `20260904205625_invite_access_groups` gerou um DROP dele por drift, que entrou
-- commitado. Sem ele a busca do diretório (`username LIKE 'x%'`) varre `auth_users` inteira: com
-- collation que não é C, o `auth_users_username_key` não serve prefixo.
--
-- Ao rodar `prisma migrate dev`, conferir se a migração gerada não traz DROP deste índice.
CREATE INDEX IF NOT EXISTS "auth_users_username_prefix_idx" ON "auth_users" ("username" text_pattern_ops);
