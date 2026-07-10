import { loadEnv } from '../../config/env.js';
import { ValidationError } from '../../utils/errors.js';

export function assertEmailChangeEnabled(): void {
  if (!loadEnv().EMAIL_CHANGE_ENABLED) {
    throw new ValidationError(
      'A troca de e-mail está temporariamente desativada.',
      'EMAIL_CHANGE_DISABLED',
    );
  }
}
