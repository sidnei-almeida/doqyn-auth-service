const SENSITIVE_KEYS = [
  'password',
  'newPassword',
  'temporaryPassword',
  'token',
  'sessionToken',
  'resetToken',
  'passwordHash',
  'sessionTokenHash',
  'tokenHash',
  'emailEncrypted',
  'emailLookupHash',
  'whatsappEncrypted',
  'whatsappLookupHash',
  'firstNameEncrypted',
  'lastNameEncrypted',
];

export function safeLog(message: string, data?: Record<string, unknown>): void {
  if (!data) {
    console.log(message);
    return;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  console.log(message, sanitized);
}
