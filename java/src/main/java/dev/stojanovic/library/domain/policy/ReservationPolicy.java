package dev.stojanovic.library.domain.policy;

import java.time.Duration;
import java.time.Instant;

/** How long a returned copy is held for the member at the head of the queue. */
public record ReservationPolicy(Duration holdPeriod) {

    public ReservationPolicy {
        if (holdPeriod.isNegative() || holdPeriod.isZero()) {
            throw new IllegalArgumentException("holdPeriod must be positive");
        }
    }

    public Instant readyUntil(Instant now) {
        return now.plus(holdPeriod);
    }
}
