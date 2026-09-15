-- Um cadastro vivo por documento fiscal em cada país.
--
-- A checagem do cadastro (findFirst antes do create) não segura duas requisições simultâneas com o
-- mesmo CPF/CNPJ: as duas passam pela busca e as duas criam tenant. Só o banco fecha essa janela.
--
-- country nulo conta como BR (tenants anteriores ao multi-país), igual à checagem em código. Status
-- fora da lista (blocked) não reserva o documento, também igual ao código.
--
-- Índice parcial com expressão: o schema.prisma não consegue descrevê-lo. Ver o aviso no model
-- AuthTenant antes de rodar `prisma migrate dev`.
CREATE UNIQUE INDEX "auth_tenants_tax_id_hash_country_live_key"
  ON "auth_tenants" ("tax_id_hash", COALESCE("country", 'BR'))
  WHERE "tax_id_hash" IS NOT NULL
    AND "status" IN ('pending', 'pending_provisioning', 'provisioning_failed', 'active');
