import assert from 'node:assert/strict';
import test from 'node:test';
import { maskFromCents, parseLegacyPriceToCents } from '../src/lib/money';

test('preserva preços legados com separador de milhar por vírgula', () => {
  assert.equal(parseLegacyPriceToCents('5,000,000'), 500_000_000);
  assert.equal(maskFromCents(parseLegacyPriceToCents('5,000,000')), '5.000.000,00');
});

test('preserva preços legados inteiros e com separador de milhar pt-BR', () => {
  assert.equal(parseLegacyPriceToCents('400000'), 40_000_000);
  assert.equal(parseLegacyPriceToCents('1.200.000'), 120_000_000);
});

test('preserva valores pt-BR já formatados com centavos', () => {
  assert.equal(parseLegacyPriceToCents('R$ 1.000.000,00'), 100_000_000);
  assert.equal(parseLegacyPriceToCents('5,00'), 500);
  assert.equal(parseLegacyPriceToCents('5,5'), 550);
});

test('aceita preço internacional com milhar e centavos sem leitura parcial', () => {
  assert.equal(parseLegacyPriceToCents('5,000.00'), 500_000);
});

test('retorna zero para preço vazio ou inválido', () => {
  assert.equal(parseLegacyPriceToCents(''), 0);
  assert.equal(parseLegacyPriceToCents('sem preço'), 0);
});
