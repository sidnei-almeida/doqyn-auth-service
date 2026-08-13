import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';

import { resetEnvCache } from '../src/config/env.js';
import { decryptField, encryptField, isEncryptedWithCurrentKey } from '../src/security/crypto.js';

/**
 * Rotação de `DATA_ENCRYPTION_KEY`.
 *
 * Antes desta capacidade a chave era introcável na prática: todo payload carrega o prefixo `v1` e
 * `decryptField` recusava qualquer outro, então trocar a chave tornava a base inteira ilegível.
 * Estes testes provam o procedimento de três passos descrito em `src/security/crypto.ts`.
 *
 * A chave é lida do env a cada chamada, então trocar a configuração é limpar o cache do env.
 */

const KEY_A = randomBytes(32).toString('base64');
const KEY_B = randomBytes(32).toString('base64');

const ORIGINAL = { ...process.env };

/**
 * Aponta o módulo de cripto para outra configuração de chave.
 *
 * Não recarrega o módulo: `crypto.ts` lê a chave a cada chamada via `loadEnv()`, então basta
 * limpar o cache do env depois de mexer em `process.env`.
 */
function useKeys(current: string, previous?: string) {
  process.env.DATA_ENCRYPTION_KEY = current;
  if (previous === undefined) {
    delete process.env.DATA_ENCRYPTION_KEY_PREVIOUS;
  } else {
    process.env.DATA_ENCRYPTION_KEY_PREVIOUS = previous;
  }
  resetEnvCache();
}

beforeEach(() => {
  process.env = { ...ORIGINAL };
  resetEnvCache();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  resetEnvCache();
});

describe('rotação de chave de dados', () => {
  it('passo 1: com a chave nova corrente e a antiga como PREVIOUS, o legado continua legível', async () => {
    useKeys(KEY_A);
    const legado = encryptField('pessoa@empresa.com');

    useKeys(KEY_B, KEY_A);
    expect(decryptField(legado)).toBe('pessoa@empresa.com');
  });

  it('passo 1: o que é gravado durante a rotação já usa a chave nova', async () => {
    useKeys(KEY_B, KEY_A);
    const novo = encryptField('outro@empresa.com');

    // legível sem a chave anterior, ou seja, já migrado
    useKeys(KEY_B);
    expect(decryptField(novo)).toBe('outro@empresa.com');
  });

  it('passo 3: removida a PREVIOUS, payload antigo deixa de ser legível — por isso o rescrito é obrigatório', async () => {
    useKeys(KEY_A);
    const legado = encryptField('pessoa@empresa.com');

    useKeys(KEY_B);
    expect(() => decryptField(legado)).toThrow();
  });

  it('isEncryptedWithCurrentKey distingue migrado de pendente', async () => {
    useKeys(KEY_A);
    const legado = encryptField('pessoa@empresa.com');

    useKeys(KEY_B, KEY_A);
    const novo = encryptField('nova@empresa.com');

    expect(isEncryptedWithCurrentKey(novo)).toBe(true);
    expect(isEncryptedWithCurrentKey(legado)).toBe(false);
  });

  it('sem chave anterior configurada, o erro de integridade sobe intacto', async () => {
    useKeys(KEY_A);
    const legado = encryptField('pessoa@empresa.com');

    useKeys(KEY_B);
    // não pode ser mascarado como "payload inválido" genérico: GCM falhou a autenticação
    expect(() => decryptField(legado)).toThrow();
  });

  it('payload adulterado continua sendo recusado mesmo com chave anterior presente', async () => {
    useKeys(KEY_B, KEY_A);
    const valido = encryptField('pessoa@empresa.com');

    const parts = valido.split(':');
    const corrompido = [parts[0], parts[1], parts[2], Buffer.from('lixo').toString('base64')].join(':');

    expect(() => decryptField(corrompido)).toThrow();
  });
});
