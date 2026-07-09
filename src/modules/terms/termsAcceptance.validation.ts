import type { ZodError } from 'zod';

export function mapTermsValidationError(error: ZodError): { code: string; message: string } | null {
  for (const issue of error.issues) {
    if (issue.path[0] === 'acceptedTerms') {
      return {
        code: 'TERMS_ACCEPTANCE_REQUIRED',
        message: 'É necessário aceitar os Termos e Condições de Uso para continuar.',
      };
    }

    if (issue.path[0] === 'acceptedTermsVersion') {
      return {
        code: 'TERMS_VERSION_INVALID',
        message: 'A versão dos Termos e Condições enviada não é válida.',
      };
    }
  }

  return null;
}

export function formatTermsValidationResponse(error: ZodError) {
  return (
    mapTermsValidationError(error) ?? {
      code: 'VALIDATION_ERROR',
      message: 'Dados inválidos.',
    }
  );
}
