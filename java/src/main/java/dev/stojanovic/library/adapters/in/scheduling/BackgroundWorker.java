package dev.stojanovic.library.adapters.in.scheduling;

import dev.stojanovic.library.application.service.IdempotencyService;
import dev.stojanovic.library.application.service.OutboxPublisher;
import dev.stojanovic.library.application.service.OverdueService;
import dev.stojanovic.library.application.service.ReservationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.function.IntSupplier;

/**
 * The in-process worker. Every step is its own transaction built on row locks / SKIP LOCKED, so any number of
 * instances can run it at the same time; a failing step is logged and retried on the next tick.
 */
@Component
public class BackgroundWorker {

    private static final Logger log = LoggerFactory.getLogger(BackgroundWorker.class);
    private static final int BATCH = 100;

    private final OverdueService overdue;
    private final ReservationService reservations;
    private final OutboxPublisher outbox;
    private final IdempotencyService idempotency;

    public BackgroundWorker(OverdueService overdue, ReservationService reservations, OutboxPublisher outbox,
                            IdempotencyService idempotency) {
        this.overdue = overdue;
        this.reservations = reservations;
        this.outbox = outbox;
        this.idempotency = idempotency;
    }

    /** Only scheduled when {@code library.worker.enabled} is true (see SchedulingConfig). */
    @Scheduled(fixedDelayString = "${library.worker.interval-ms}", initialDelayString = "${library.worker.interval-ms}")
    public void tick() {
        runOnce();
    }

    public void runOnce() {
        step("overdue scan", () -> overdue.notifyOverdueLoans(BATCH));
        step("reservation expiry", () -> reservations.expireHolds(BATCH));
        step("outbox publisher", () -> outbox.publishBatch(BATCH));
        step("idempotency cleanup", idempotency::purgeExpiredKeys);
    }

    private static void step(String name, IntSupplier action) {
        try {
            int processed = action.getAsInt();
            if (processed > 0) {
                log.info("worker step '{}' processed {} rows", name, processed);
            }
        } catch (RuntimeException e) {
            log.error("worker step '{}' failed; retrying next tick", name, e);
        }
    }
}
