/** Catálogo central de códigos e mensagens do auth-service. */
export const AUTH_ERROR_CODES = {
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  USER_DISABLED: 'USER_DISABLED',
  RATE_LIMIT: 'RATE_LIMIT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_SESSION: 'INVALID_SESSION',
  NO_SESSION: 'NO_SESSION',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  NO_ACTIVE_MEMBERSHIP: 'NO_ACTIVE_MEMBERSHIP',
  NO_ACTIVE_TENANT: 'NO_ACTIVE_TENANT',
  TENANT_REQUIRED: 'TENANT_REQUIRED',
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  TENANT_INACTIVE: 'TENANT_INACTIVE',
  TENANT_PROVISIONING_FAILED: 'TENANT_PROVISIONING_FAILED',
  MEMBERSHIP_PENDING: 'MEMBERSHIP_PENDING',
  MEMBERSHIP_BLOCKED: 'MEMBERSHIP_BLOCKED',
  MEMBERSHIP_REJECTED: 'MEMBERSHIP_REJECTED',
  MEMBERSHIP_REMOVED: 'MEMBERSHIP_REMOVED',
  MEMBERSHIP_NOT_ACTIVE: 'MEMBERSHIP_NOT_ACTIVE',
  MEMBERSHIP_NOT_FOUND: 'MEMBERSHIP_NOT_FOUND',
  USER_NOT_ACTIVE: 'USER_NOT_ACTIVE',
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  INVALID_CREDENTIALS: 'E-mail ou senha inválidos.',
  USER_DISABLED: 'Esta conta foi desativada. Entre em contato com o administrador.',
  RATE_LIMIT: 'Muitas tentativas. Tente novamente mais tarde.',
  VALIDATION_ERROR: 'Revise os campos informados e tente novamente.',
  INVALID_SESSION: 'Sua sessão expirou. Faça login novamente.',
  NO_SESSION: 'Faça login para continuar.',
  SESSION_EXPIRED: 'Sua sessão expirou. Faça login novamente.',
  AUTH_REQUIRED: 'Faça login para continuar.',
  FORBIDDEN: 'Você não tem permissão para acessar esta área.',
  NO_ACTIVE_MEMBERSHIP: 'Sua conta ainda não possui acesso ativo a nenhuma empresa.',
  NO_ACTIVE_TENANT: 'Selecione uma empresa para continuar.',
  TENANT_REQUIRED: 'Esta ação exige uma empresa ativa.',
  TENANT_NOT_FOUND: 'Empresa não encontrada ou indisponível para sua conta.',
  TENANT_INACTIVE: 'Esta empresa não está ativa no DOQYN.',
  TENANT_PROVISIONING_FAILED:
    'O ambiente desta empresa ainda não foi configurado corretamente. Tente novamente mais tarde ou contate o suporte.',
  MEMBERSHIP_PENDING: 'Sua solicitação de acesso ainda está aguardando aprovação.',
  MEMBERSHIP_BLOCKED: 'Seu acesso a esta empresa foi bloqueado.',
  MEMBERSHIP_REJECTED: 'Sua solicitação de acesso a esta empresa foi rejeitada.',
  MEMBERSHIP_REMOVED: 'Você não faz mais parte desta empresa no DOQYN.',
  MEMBERSHIP_NOT_ACTIVE: 'Sua associação a esta empresa não está ativa.',
  MEMBERSHIP_NOT_FOUND: 'Associação à empresa não encontrada.',
  USER_NOT_ACTIVE: 'Esta conta não está ativa.',
};

export function authErrorResponse(
  code: AuthErrorCode,
  overrides?: { message?: string; details?: Record<string, unknown> },
) {
  return {
    ok: false as const,
    code,
    message: overrides?.message ?? AUTH_ERROR_MESSAGES[code],
    ...(overrides?.details ? { details: overrides.details } : {}),
  };
}
