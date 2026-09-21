import { describe, it, expect } from 'vitest';
import { isValidCnpj, isValidCpf, isValidTaxIdForCountry } from '../src/utils/taxIdValidation.js';

describe('validação de documento fiscal', () => {
  it('CPF: dígito verificador e sequência repetida', () => {
    expect(isValidCpf('123.456.789-09')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('123.456.789-00')).toBe(false);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('1234567890')).toBe(false);
  });

  it('CNPJ numérico e alfanumérico', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000180')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
    // Exemplo da Receita para o CNPJ alfanumérico.
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(isValidCnpj('12abc34501de35')).toBe(true);
    expect(isValidCnpj('12ABC34501DE36')).toBe(false);
    expect(isValidCnpj('12ABC34501DEA5')).toBe(false);
  });

  it('BR confere dígito conforme o tipo de pessoa; fora do BR só tamanho', () => {
    expect(isValidTaxIdForCountry('BR', '12345678900', 'individual', 'cpf')).toBe(false);
    expect(isValidTaxIdForCountry('BR', '12345678909', 'individual', 'cpf')).toBe(true);
    expect(isValidTaxIdForCountry('BR', '12345678909', 'company', 'cnpj')).toBe(false);
    expect(isValidTaxIdForCountry('BR', '12ABC34501DE35', 'company', 'cnpj')).toBe(true);
    expect(isValidTaxIdForCountry('ES', 'X1234567L', 'individual', 'nif')).toBe(true);
  });
});
