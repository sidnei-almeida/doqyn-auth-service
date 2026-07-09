export type OAuthProviderName = 'google' | 'microsoft';

export type OAuthPendingPayload = {
  provider: OAuthProviderName;
  state: string;
  nonce: string;
  codeVerifier: string;
  returnUrl: string;
  createdAt: number;
};

export type OAuthIdentity = {
  provider: OAuthProviderName;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  providerTenantId: string | null;
};

export type OAuthPostLoginStatus =
  | 'success'
  | 'onboarding_required'
  | 'membership_pending'
  | 'membership_blocked'
  | 'membership_rejected'
  | 'error';

export type OAuthStartResult = {
  redirectUrl: string;
  pending: OAuthPendingPayload;
};

export type OAuthCallbackResult =
  | {
      ok: true;
      sessionToken: string;
      status: OAuthPostLoginStatus;
      code?: string;
    }
  | {
      ok: false;
      status: 'error';
      code: string;
      message: string;
    };
