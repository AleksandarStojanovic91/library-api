export interface Money {
  readonly amount: string;
  readonly currency: 'EUR';
}

/** 150 -> { amount: "1.50", currency: "EUR" }. Integer cents avoid floating point in money math. */
export function centsToMoney(cents: number): Money {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError(`Invalid amount in cents: ${cents}`);
  }
  const euros = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, '0');
  return { amount: `${euros}.${rest}`, currency: 'EUR' };
}
