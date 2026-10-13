import { describe, expect, it } from 'vitest';
import { isbn13CheckDigit, isValidIsbn13 } from '../../src/domain/catalog/isbn';

describe('ISBN-13', () => {
  it.each(['9780132350884', '9781449373320', '9780321125217', '9788652117895', '9790000000001'])('accepts %s', (isbn) => {
    expect(isValidIsbn13(isbn)).toBe(true);
  });

  it.each([
    ['wrong check digit', '9780132350885'],
    ['wrong prefix', '9770132350884'],
    ['too short', '978013235088'],
    ['letters', '978013235088X'],
    ['ISBN-10', '0132350882'],
  ])('rejects %s', (_, isbn) => {
    expect(isValidIsbn13(isbn)).toBe(false);
  });

  it('computes the check digit with alternating weights 1 and 3', () => {
    expect(isbn13CheckDigit('978013235088')).toBe(4);
    expect(isbn13CheckDigit('978000000000')).toBe((10 - ((9 + 7 * 3 + 8) % 10)) % 10);
    expect(() => isbn13CheckDigit('12')).toThrow(RangeError);
  });
});
