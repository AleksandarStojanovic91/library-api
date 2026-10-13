const ISBN13_PATTERN = /^97[89]\d{10}$/;

/** ISBN-13 check digit: weights alternate 1 and 3; the check digit tops the sum up to a multiple of 10. */
export function isbn13CheckDigit(first12Digits: string): number {
  if (!/^\d{12}$/.test(first12Digits)) {
    throw new RangeError('Expected exactly 12 digits');
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(first12Digits[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidIsbn13(value: string): boolean {
  return ISBN13_PATTERN.test(value) && isbn13CheckDigit(value.slice(0, 12)) === Number(value[12]);
}
