/**
 * Os idiomas que a plataforma fala.
 *
 * **Cópia proposital de `src/i18n/locales.ts` do `doqyn-alpha-document-intelligence`.** Os dois
 * repositórios são processos separados e não compartilham código; a alternativa seria publicar
 * um pacote só para três strings. Mudou aqui, mude lá — e o contrário. É o mesmo arranjo já
 * documentado em `src/modules/email/emailLayout.ts`.
 *
 * Aqui a lista serve para **recusar entrada**, não para escolher o que oferecer: quem decide o
 * que aparece no seletor é o front, que sabe quais catálogos já estão completos. O servidor só
 * precisa garantir que não vai gravar `klingon` numa coluna que depois manda e-mail.
 */

export const SUPPORTED_LOCALES = ['pt-BR', 'en-US', 'es-419'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'pt-BR';

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Reduz uma etiqueta BCP-47 ao idioma mais próximo que sabemos falar.
 *
 * O navegador manda `pt`, `pt-PT`, `es-MX`, `en-GB` — variantes sem catálogo próprio. Cair na
 * mais próxima é melhor do que cair no padrão: um mexicano lendo `es-419` está em casa; lendo
 * português, não.
 */
export function normalizeLocale(value: string | null | undefined): SupportedLocale | null {
  if (!value) return null;
  const tag = value.trim().replace('_', '-');
  if (!tag) return null;
  if (isSupportedLocale(tag)) return tag;

  const primary = tag.split('-')[0]?.toLowerCase();
  if (primary === 'pt') return 'pt-BR';
  if (primary === 'en') return 'en-US';
  if (primary === 'es') return 'es-419';
  return null;
}

/**
 * O fuso vem do cliente e vai para uma coluna; validar aqui evita gravar lixo que só apareceria
 * meses depois, como uma data de auditoria em branco. `Intl` já conhece a lista IANA inteira —
 * não vale manter uma cópia dela.
 */
export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
