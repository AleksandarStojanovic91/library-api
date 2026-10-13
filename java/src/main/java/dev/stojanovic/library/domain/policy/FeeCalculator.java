package dev.stojanovic.library.domain.policy;

import java.time.Duration;
import java.time.Instant;

/** Overdue fee: every started day after the due date costs {@code centsPerDay}. */
public record FeeCalculator(int centsPerDay) {

    private static final long MILLIS_PER_DAY = Duration.ofDays(1).toMillis();

    public FeeCalculator {
        if (centsPerDay < 0) {
            throw new IllegalArgumentException("centsPerDay must not be negative");
        }
    }

    /** 0 when {@code at} is on or before {@code dueAt}. */
    public long feeCents(Instant dueAt, Instant at) {
        return startedDaysLate(dueAt, at) * centsPerDay;
    }

    static long startedDaysLate(Instant dueAt, Instant at) {
        long lateMillis = Duration.between(dueAt, at).toMillis();
        return lateMillis <= 0 ? 0 : Math.ceilDiv(lateMillis, MILLIS_PER_DAY);
    }
}
