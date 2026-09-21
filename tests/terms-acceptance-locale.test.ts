import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { termsAcceptanceSchema } from '../src/modules/terms/termsAcceptance.schemas.js';
import { DOQYN_TERMS_VERSION } from '../src/modules/terms/terms.constants.js';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('aceite dos termos grava o idioma em que foram lidos', () => {
  it('o idioma é opcional, para o cliente antigo continuar aceitando', () => {
    const base = { acceptedTerms: true as const, acceptedTermsVersion: DOQYN_TERMS_VERSION };
    expect(termsAcceptanceSchema.parse(base).acceptedTermsLocale).toBeUndefined();
    expect(
      termsAcceptanceSchema.parse({ ...base, acceptedTermsLocale: 'es-419' }).acceptedTermsLocale,
    ).toBe('es-419');
    expect(() =>
      termsAcceptanceSchema.parse({ ...base, acceptedTermsLocale: 'x'.repeat(40) }),
    ).toThrow();
  });

  it('o registro normaliza o idioma, e os três fluxos o repassam', () => {
    expect(read('src/modules/terms/termsAcceptance.service.ts')).toContain(
      'locale: normalizeLocale(input.locale) ?? DEFAULT_LOCALE',
    );
    for (const file of [
      'src/modules/company-signups/companySignups.service.ts',
      'src/modules/individual-signups/individualSignups.service.ts',
      'src/modules/invites/invites.service.ts',
    ]) {
      expect(read(file)).toContain('locale: input.acceptedTermsLocale');
    }
  });
});
