import { loadEnv } from '../../config/env.js';
import type { OAuthProviderName } from './oauth.types.js';

export type OAuthProviderConfig = {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function getGoogleOAuthConfig(): OAuthProviderConfig {
  const env = loadEnv();
  return {
    enabled: env.OAUTH_GOOGLE_ENABLED,
    clientId: env.OAUTH_GOOGLE_CLIENT_ID ?? '',
    clientSecret: env.OAUTH_GOOGLE_CLIENT_SECRET ?? '',
    redirectUri: env.OAUTH_GOOGLE_REDIRECT_URI ?? '',
  };
}

export function getMicrosoftOAuthConfig(): OAuthProviderConfig & { tenant: string } {
  const env = loadEnv();
  return {
    enabled: env.OAUTH_MICROSOFT_ENABLED,
    clientId: env.OAUTH_MICROSOFT_CLIENT_ID ?? '',
    clientSecret: env.OAUTH_MICROSOFT_CLIENT_SECRET ?? '',
    redirectUri: env.OAUTH_MICROSOFT_REDIRECT_URI ?? '',
    tenant: env.OAUTH_MICROSOFT_TENANT ?? 'common',
  };
}

export function isOAuthProviderEnabled(provider: OAuthProviderName): boolean {
  if (provider === 'google') return getGoogleOAuthConfig().enabled;
  return getMicrosoftOAuthConfig().enabled;
}

export function redactEmail(email: string | null | undefined): string | undefined {
  if (!email) return undefined;
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const visible = local.slice(0, 2);
  return `${visible}***@${domain}`;
}
