/** Source of "now" for business rules (loan due dates, fees, reservation holds). */
export interface Clock {
  now(): Date;
}

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
