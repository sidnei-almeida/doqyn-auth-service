export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Não autorizado.', code = 'UNAUTHORIZED') {
    super(message, 401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Acesso negado.', code = 'FORBIDDEN') {
    super(message, 403, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Recurso não encontrado.', code = 'NOT_FOUND') {
    super(message, 404, code);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Dados inválidos.', code = 'VALIDATION_ERROR') {
    super(message, 400, code);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Muitas tentativas. Tente novamente mais tarde.') {
    super(message, 429, 'RATE_LIMIT');
  }
}

export class TenantScopeViolationError extends AppError {
  constructor(message = 'Operação fora do escopo do tenant.') {
    super(message, 403, 'TENANT_SCOPE_VIOLATION');
  }
}

export class LastAdminProtectionError extends AppError {
  constructor(message = 'Não é permitido remover o último administrador ativo do tenant.') {
    super(message, 409, 'LAST_ADMIN_PROTECTION');
  }
}

export class GroupNotActiveError extends AppError {
  constructor(message = 'Grupo de acesso não está ativo.') {
    super(message, 400, 'GROUP_NOT_ACTIVE');
  }
}

export class MembershipNotActiveError extends AppError {
  constructor(message = 'Membership não está ativa.') {
    super(message, 400, 'MEMBERSHIP_NOT_ACTIVE');
  }
}

export class TenantNotActiveError extends AppError {
  constructor(message = 'Tenant não está ativo.') {
    super(message, 400, 'TENANT_NOT_ACTIVE');
  }
}

export class UserNotActiveError extends AppError {
  constructor(message = 'Usuário não está ativo.') {
    super(message, 400, 'USER_NOT_ACTIVE');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT') {
    super(message, 409, code);
  }
}

export class GoneError extends AppError {
  constructor(message: string, code = 'GONE') {
    super(message, 410, code);
  }
}
