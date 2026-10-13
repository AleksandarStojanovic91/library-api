import type { Logger } from '@nestjs/common';

/**
 * During an outage every request would log the same warning; one line per interval is enough to notice
 * (and keeps the logs readable), with a count of how many were suppressed.
 */
export function throttledWarn(logger: Logger, intervalMs = 10_000): (error: unknown, message: string) => void {
  let lastLoggedAt = 0;
  let suppressed = 0;
  return (error, message) => {
    const now = Date.now();
    if (now - lastLoggedAt < intervalMs) {
      suppressed++;
      return;
    }
    logger.warn({ err: error, suppressed }, message);
    lastLoggedAt = now;
    suppressed = 0;
  };
}
