-- Contas que já existem passam a valer como confirmadas.
--
-- O login agora recusa quem tem `email_verified = false`, e isso trancaria fora todo mundo que já
-- usa o sistema: o cadastro PF sempre nasceu `false` — nada consultava o campo, então ninguém
-- notava — e as contas de empresa nasciam `true` sem prova nenhuma. Trancar as PF seria regressão
-- para quem entrava ontem, e nada ganharia com isso: o `true` das de empresa também nunca foi
-- provado.
--
-- `NOW()` aqui é o instante em que a migração roda: pega exatamente o que já existe, e nada do
-- que vier depois. A garantia começa daqui para a frente.
UPDATE "auth_users"
   SET "email_verified" = true
 WHERE "email_verified" = false
   AND "created_at" < NOW();
