import { describe, it, expect, afterEach } from 'vitest';
import { resetEnvCache } from '../src/config/env.js';
import { getResendConfig, isPlatformEmailConfigured } from '../src/modules/email/email.service.js';

/**
 * A escolha de provedor de e-mail.
 *
 * O que se protege aqui não é o envio — isso depende da rede — e sim as três perguntas que
 * decidem se o convite sai: qual provedor está escolhido, se ele tem credencial, e se o serviço
 * se declara configurado. Errar a terceira foi o que fez o convite voltar dizendo
 * `smtp_not_configured` numa instalação que só usava Resend.
 */

const ORIGINAL = { ...process.env };

function setEnv(vars: Record<string, string>) {
  for (const key of ['EMAIL_ENABLED', 'EMAIL_PROVIDER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD']) {
    delete process.env[key];
  }
  Object.assign(process.env, vars);
  resetEnvCache();
}

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
  resetEnvCache();
});

describe('seleção de provedor de e-mail', () => {
  it('sem EMAIL_ENABLED nada está configurado, mesmo com chave da Resend', () => {
    setEnv({ EMAIL_ENABLED: 'false', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_chave' });
    expect(isPlatformEmailConfigured()).toBe(false);
  });

  it('Resend escolhida e com chave configura a plataforma sem nenhum SMTP', () => {
    setEnv({ EMAIL_ENABLED: 'true', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_chave' });
    expect(getResendConfig()).toMatchObject({ apiKey: 're_chave' });
    expect(isPlatformEmailConfigured()).toBe(true);
  });

  it('Resend escolhida sem chave não configura nada, e não cai no SMTP por engano', () => {
    setEnv({ EMAIL_ENABLED: 'true', EMAIL_PROVIDER: 'resend' });
    expect(getResendConfig()).toBeNull();
    expect(isPlatformEmailConfigured()).toBe(false);
  });

  it('com o provedor em smtp a chave da Resend é ignorada', () => {
    setEnv({
      EMAIL_ENABLED: 'true',
      EMAIL_PROVIDER: 'smtp',
      RESEND_API_KEY: 're_chave',
      SMTP_HOST: 'smtp.exemplo.com',
      SMTP_USER: 'user',
      SMTP_PASSWORD: 'senha',
    });
    // Ter a chave no ambiente não basta: quem decide é `EMAIL_PROVIDER`, para que trocar de
    // provedor seja um gesto explícito e não um efeito de sobrar uma variável no `.env`.
    expect(getResendConfig()).toBeNull();
    expect(isPlatformEmailConfigured()).toBe(true);
  });

  it('sem provedor nenhum de pé, a plataforma se declara não configurada', () => {
    setEnv({ EMAIL_ENABLED: 'true', EMAIL_PROVIDER: 'smtp' });
    expect(isPlatformEmailConfigured()).toBe(false);
  });
});
