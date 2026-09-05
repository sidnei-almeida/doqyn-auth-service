-- O convite deixa de carregar grupo de acesso.
--
-- Quem decide o que a pessoa alcança é `document_group_members`, no Mongo do alpha — a tabela
-- daqui era uma segunda cópia da mesma decisão, com id próprio, que a governança nunca lia. Duas
-- cópias de uma decisão só divergem em silêncio, e a que ninguém lê é justamente a que diverge
-- sem ser notada.
--
-- `auth_access_groups` e `auth_membership_access_groups` ficam de pé: `approve` e `updateAccess`
-- ainda escrevem neles.

-- DropTable
DROP TABLE "auth_invite_access_groups";
