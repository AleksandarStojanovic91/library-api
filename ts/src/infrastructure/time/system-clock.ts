import type { Clock } from '../../domain/shared/clock';

/** Wall clock shifted by CLOCK_OFFSET_SECONDS, so tests can run the service "in the future". */
export class SystemClock implements Clock {
  constructor(private readonly offsetSeconds: number = 0) {}

  now(): Date {
    return new Date(Date.now() + this.offsetSeconds * 1000);
  }
}
