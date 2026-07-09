const ALLOWED_RETURN_PATHS = new Set([
  '/upload',
  '/dashboard',
  '/documents',
  '/biblioteca',
  '/settings',
  '/rules',
  '/users',
  '/audit',
  '/tracking',
  '/versioning',
  '/onboarding',
]);

export function sanitizeReturnUrl(input: string | undefined, fallback = '/upload'): string {
  if (!input?.trim()) return fallback;

  const value = input.trim();

  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('//')) {
    return fallback;
  }

  const path = value.startsWith('/') ? value : `/${value}`;
  const pathname = path.split('?')[0]?.split('#')[0] ?? path;

  if (!ALLOWED_RETURN_PATHS.has(pathname)) {
    return fallback;
  }

  return path;
}
