-- Um convite pendente por e-mail em cada tenant.
--
-- `createInvite` decide entre reaproveitar o pendente e criar outro por um findFirst. Dois pedidos
-- simultâneos (clique duplo, retry depois de resposta lenta) passavam os dois pela busca e criavam
-- duas linhas, cada uma com token próprio. Só o banco fecha essa janela.
--
-- Índice parcial: o schema.prisma não consegue descrevê-lo. Ver o aviso no model AuthInvite antes
-- de rodar `prisma migrate dev`.

-- Duplicatas que já existam impediriam o índice: fica o pendente mais recente, os outros viram
-- revogados.
UPDATE "auth_invites" AS older
SET "status" = 'revoked', "updated_at" = NOW()
WHERE older."status" = 'pending'
  AND EXISTS (
    SELECT 1 FROM "auth_invites" AS newer
    WHERE newer."status" = 'pending'
      AND newer."tenant_id" = older."tenant_id"
      AND newer."email_lookup_hash" = older."email_lookup_hash"
      AND (newer."created_at", newer."id") > (older."created_at", older."id")
  );

CREATE UNIQUE INDEX "auth_invites_tenant_email_pending_key"
  ON "auth_invites" ("tenant_id", "email_lookup_hash")
  WHERE "status" = 'pending';
