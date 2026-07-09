# doqyn-auth-service

Serviço seguro de **identidade e acesso** para o DOQYN. Responsável por autenticação, tenants, memberships, roles, grupos de acesso e solicitações de acesso.

## O que é

API independente usada pelo frontend DOQYN e pela API principal. O usuário final vê apenas o DOQYN — o auth-service fica transparente atrás de rotas como `/auth/*`.

## O que faz

- Autenticação (login, logout, sessão, reset de senha)
- Identidade de usuários com PII criptografada
- **Tenants** (empresas e pessoas físicas)
- **Memberships** (vínculo usuário ↔ tenant)
- **Roles** (`doqyn_admin`, `company_admin`, `individual_admin`, `user`)
- **Access groups** (grupos de acesso por tenant)
- **Solicitações de acesso** públicas
- **Admin** (aprovar, rejeitar, bloquear, gerenciar acesso)
- Auditoria de autenticação e acesso

## O que **não** faz

- OIDC / SAML / OAuth provider completo
- Social login
- Documentos, upload, OCR, IA ou storage
- Regras documentais detalhadas ou permissões por documento
- Metadados documentais (isso fica no **MongoDB** da API principal)

## Divisão de responsabilidades

| Auth-service (PostgreSQL) | API principal (MongoDB) |
|---------------------------|---------------------------|
| Identidade e credenciais | Documentos e metadados |
| Tenants e memberships | Regras documentais |
| Roles e access groups | Permissões por documento |
| Solicitações de acesso | Auditoria de produto |
| Sessões e cookies | `/api/me` (contrato do produto) |

> O contrato principal do produto continua sendo **`/api/me`** na API principal DOQYN, que consultará o auth-service para identidade e acesso.

## Arquitetura (desenvolvimento)

| Componente        | URL                        |
|-------------------|----------------------------|
| Frontend DOQYN    | http://localhost:5173      |
| Auth Service      | http://localhost:4100      |
| API principal     | http://localhost:3001      |
| PostgreSQL Auth   | localhost:5433 (Docker)    |

## Como rodar localmente

Fluxo recomendado (sobe Postgres automaticamente, valida Prisma e inicia o serviço):

```bash
npm install
cp .env.example .env
npm run dev
```

O comando `npm run dev`:
1. garante que o Postgres dev (`postgres-auth`) esteja rodando via Docker;
2. espera o banco responder em `127.0.0.1:5433`;
3. valida conexão Prisma (`SELECT 1`);
4. só então inicia o auth-service na porta `4100`.

Comandos úteis:

```bash
npm run dev:db            # sobe somente Postgres (postgres-auth)
npm run dev:db:status     # status do container
npm run dev:db:logs       # logs do Postgres
npm run audit:auth-health # diagnóstico seguro do banco
npm run dev:server        # sobe só o servidor (sem garantir Postgres)
npm run dev:local         # Postgres + migrations + servidor
```

Primeira vez ou após clone (migrations + seed opcional):

```bash
npm run dev:local         # inclui npx prisma migrate deploy
npm run db:seed           # apenas desenvolvimento, manual
```

> **Importante:** `npm run dev` **não** roda seed nem reset de senha automaticamente.
> Use `SEED_FORCE_PASSWORD_RESET=true npm run db:seed` apenas se quiser sobrescrever senhas dev existentes.

> **Cuidado com testes:** se `TEST_DATABASE_URL` não estiver configurado, `npm test` usa o mesmo `DATABASE_URL` de dev e apaga users/tenants no `beforeEach`. Configure um banco separado em `.env` ou use `npm run audit:auth-storage` para diagnosticar banco vazio.

> **Evite** `docker compose up -d` sem filtro — isso também sobe `auth-api` na porta `4100` e compete com `npm run dev`.

Documentação completa da API admin: [docs/AUTH_ADMIN_API.md](docs/AUTH_ADMIN_API.md).

## Deploy na VPS (produção)

```bash
chmod +x scripts/setup-production-env.sh scripts/deploy-production.sh
./scripts/setup-production-env.sh   # gera .env (chmod 600)
./scripts/deploy-production.sh      # sobe stack + migrations
```

Verificar: `docker compose ps` e `curl http://localhost:4100/health`

Logs: `docker compose logs -f auth-api`

**Crítico:** nunca perca `DATA_ENCRYPTION_KEY`, nunca commite `.env`, nunca `docker compose down -v` em produção.

Guia completo: [docs/DEPLOY_VPS.md](docs/DEPLOY_VPS.md)

### Local vs Docker

| Ambiente | Host no `DATABASE_URL` |
|----------|------------------------|
| `npm run dev` | `localhost:5433` |
| Docker / VPS | `postgres-auth:5432` |

## Seed de desenvolvimento

```bash
npm run db:seed
# ou no container após deploy/build:
npm run db:seed:docker
```

Cria (somente em `NODE_ENV !== production`):

| Item | Valor |
|------|-------|
| Tenant | `company_dev` (business, active) |
| Usuário | `sidnei@doqyn.dev` |
| Senha | `SEED_DEV_PASSWORD` ou `dev-password-change-me` |
| Roles | `company_admin`, `user` |
| Grupos | `group_financeiro`, `group_juridico`, `group_rh`, `group_compras`, `group_diretoria` |

Sidnei é vinculado a **todos os grupos** (decisão documentada para facilitar testes em dev).

## Testar login

```bash
curl -X POST http://localhost:4100/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"email":"sidnei@doqyn.dev","password":"dev-password-change-me"}'

curl http://localhost:4100/auth/session -b cookies.txt
```

Resposta de sessão inclui `user`, `activeMembership` (roles + `accessGroupIds` apenas de grupos com `status=active`) e `memberships`.

## Testar approval

```bash
# 1. Login como admin (seed)
curl -X POST http://localhost:4100/auth/login ... -c cookies.txt

# 2. Listar solicitações pendentes
curl http://localhost:4100/auth/admin/access-requests -b cookies.txt

# 3. Aprovar membership
curl -X POST http://localhost:4100/auth/admin/members/{membershipId}/approve \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"roles":["user"],"accessGroupIds":["group_financeiro"]}'
```

## Modelo de dados

### Tenants (`auth_tenants`)
Identificador externo `tenantId` (ex: `company_dev`), tipo, nome criptografado, CPF/CNPJ mascarado + hash.

### Memberships (`auth_memberships`)
Vínculo usuário ↔ tenant com status (`pending`, `active`, `blocked`, `rejected`).

### Roles (`auth_membership_roles`)
`doqyn_admin` | `company_admin` | `individual_admin` | `user`

### Access groups (`auth_access_groups`)
Grupos por tenant (ex: `group_financeiro`). Associação via `auth_membership_access_groups`.

### Access requests (`auth_access_requests`)
Fluxo público de solicitação de acesso. Usuário **não** escolhe roles/grupos — admin define na aprovação.

## Endpoints públicos

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/health` | Health check |
| POST | `/auth/login` | Login |
| POST | `/auth/logout` | Logout |
| GET | `/auth/session` | Sessão + activeMembership + memberships |
| POST | `/auth/select-tenant` | Seleciona tenant ativo (múltiplas memberships) |
| POST | `/auth/access-requests` | Solicitação de acesso |
| POST | `/auth/request-password-reset` | Reset de senha |
| POST | `/auth/reset-password` | Confirma reset |

## Endpoints admin (requer sessão + role admin)

Ver documentação completa: [docs/AUTH_ADMIN_API.md](docs/AUTH_ADMIN_API.md)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/auth/admin/members` | Lista memberships (paginado) |
| GET | `/auth/admin/members/:id` | Detalhe do membro |
| PATCH | `/auth/admin/members/:id/roles` | Atualiza roles |
| PATCH | `/auth/admin/members/:id/access-groups` | Atualiza grupos |
| POST | `/auth/admin/members/:id/approve` | Aprova com roles e grupos |
| POST | `/auth/admin/members/:id/reject` | Rejeita |
| POST | `/auth/admin/members/:id/block` | Bloqueia |
| POST | `/auth/admin/members/:id/unblock` | Desbloqueia |
| POST | `/auth/admin/members/:id/remove` | Remove do tenant |
| POST | `/auth/admin/members/:id/revoke-sessions` | Revoga sessões |
| GET | `/auth/admin/access-requests` | Lista solicitações |
| GET/POST/PATCH/DELETE | `/auth/admin/access-groups` | CRUD de grupos |
| GET/POST/PATCH | `/auth/admin/tenants` | Gestão de tenants (`doqyn_admin`) |
| POST | `/auth/account/request-deletion` | Solicita exclusão de conta |
| POST | `/auth/admin/users/:userId/deactivate` | Desativa usuário (`doqyn_admin`) |

**Regras:** `doqyn_admin` gerencia qualquer tenant; `company_admin`/`individual_admin` apenas o próprio; `user` recebe 403.

## Endpoints internos

Requerem `Authorization: Bearer <DOQYN_INTERNAL_API_KEY>`.

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/internal/sessions/verify` | Valida sessão + activeMembership |
| GET | `/internal/tenants/:tenantId` | Dados do tenant |
| GET | `/internal/tenants/:tenantId/access-groups` | Grupos do tenant |
| GET | `/internal/users/:userId` | Usuário |
| GET | `/internal/memberships/:membershipId` | Membership com roles e grupos |
| POST | `/internal/users` | Cria usuário |
| ... | ... | disable/enable/by-email |

## Integração futura com app principal

1. Frontend chama `/auth/*` com `credentials: 'include'`
2. API principal lê cookie e chama `POST /internal/sessions/verify`
3. Recebe `user` + `activeMembership` (roles, accessGroupIds)
4. MongoDB resolve documentos e metadados documentais
5. `/api/me` agrega identidade + acesso + contexto documental

## Segurança

- Argon2id, cookies HttpOnly, PII criptografada (AES-256-GCM)
- Session/reset tokens apenas como hash
- CPF/CNPJ: mascarado + hash (nunca cru no banco)
- Rate limit, mensagens genéricas, auditoria

## Testes

```bash
npm test        # suite completa
npm run build
npm run lint
```

## Scripts

| Script | Descrição |
|--------|-----------|
| `npm run dev` | Desenvolvimento |
| `npm run db:seed` | Seed local (não produção) |
| `npm run prisma:migrate` | Migrations |
| `npm run docker:up` | Docker Compose |
| `npm run deploy:setup` | Gera `.env` de produção (interativo) |
| `npm run deploy:production` | Deploy VPS (Postgres + migrate + API) |

## Pendências

- Envio de e-mail (reset, verificação, notificações)
- Integração `AUTH_PROVIDER=doqyn_auth` na API principal
- Rate limit distribuído (Redis)
- Configurar Nginx na VPS (ver [docs/DEPLOY_VPS.md](docs/DEPLOY_VPS.md))
