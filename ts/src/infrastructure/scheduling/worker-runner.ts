import { Inject, Injectable, Logger, type BeforeApplicationShutdown, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job } from '../../application/worker/jobs';

export const WORKER_JOBS = Symbol('WorkerJobs');
export const WORKER_INTERVAL_MS = Symbol('WorkerIntervalMs');

/**
 * Runs the jobs one after another every interval. A new tick is scheduled only after the previous one
 * finished (setTimeout, not setInterval), so ticks never overlap within an instance; across instances the
 * jobs' row locks keep them apart. One failing job does not stop the others.
 */
@Injectable()
export class WorkerRunner implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(WorkerRunner.name);
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<unknown> | undefined;
  private stopped = false;

  constructor(
    @Inject(WORKER_JOBS) private readonly jobs: readonly Job[],
    @Inject(WORKER_INTERVAL_MS) private readonly intervalMs: number,
  ) {}

  onApplicationBootstrap(): void {
    if (this.intervalMs > 0) {
      this.scheduleNext();
    } else {
      this.logger.log('Background worker disabled (WORKER_INTERVAL_MS=0)');
    }
  }

  /** Runs every job once. Public so tests can drive the worker deterministically. */
  async tick(): Promise<Record<string, number>> {
    const processed: Record<string, number> = {};
    for (const job of this.jobs) {
      try {
        processed[job.name] = await job.run();
      } catch (error) {
        this.logger.error({ err: error, job: job.name }, 'Background job failed');
      }
    }
    const busy = Object.entries(processed).filter(([, count]) => count > 0);
    if (busy.length > 0) {
      this.logger.log({ processed: Object.fromEntries(busy) }, 'Background jobs processed items');
    }
    return processed;
  }

  /** Stop scheduling and wait for a running tick, so pools are not closed under it. */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.inFlight;
  }

  private scheduleNext(): void {
    this.timer = setTimeout(() => {
      this.inFlight = this.tick().finally(() => {
        this.inFlight = undefined;
        if (!this.stopped) {
          this.scheduleNext();
        }
      });
    }, this.intervalMs);
    this.timer.unref();
  }
}
