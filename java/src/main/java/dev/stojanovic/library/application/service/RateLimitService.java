package dev.stojanovic.library.application.service;

import dev.stojanovic.library.application.model.RateLimitDecision;
import dev.stojanovic.library.application.port.out.RateCounter;

import java.time.Clock;
import java.time.Duration;
import java.util.OptionalLong;

/**
 * Fixed one-minute window per client ({@code <namespace>:{subject or IP}:{epochMinute}}; the namespace lets
 * instances that share a Redis keep separate budgets). Fails open: if the counter store is
 * down, requests are allowed rather than turning a cache outage into an API outage.
 */
public class RateLimitService {

    private static final long WINDOW_SECONDS = 60;

    private final RateCounter counter;
    private final Clock clock;
    private final String namespace;
    private final long limitPerMinute;

    public RateLimitService(RateCounter counter, Clock clock, String namespace, long limitPerMinute) {
        if (limitPerMinute < 1) {
            throw new IllegalArgumentException("limitPerMinute must be positive");
        }
        this.counter = counter;
        this.clock = clock;
        this.namespace = namespace;
        this.limitPerMinute = limitPerMinute;
    }

    public RateLimitDecision check(String client) {
        long epochSecond = clock.instant().getEpochSecond();
        long window = Math.floorDiv(epochSecond, WINDOW_SECONDS);
        long resetSeconds = WINDOW_SECONDS - Math.floorMod(epochSecond, WINDOW_SECONDS);
        OptionalLong count = counter.increment(namespace + ":" + client + ":" + window, Duration.ofSeconds(WINDOW_SECONDS + 1));
        if (count.isEmpty()) {
            return new RateLimitDecision(true, limitPerMinute, limitPerMinute, resetSeconds);
        }
        long used = count.getAsLong();
        return new RateLimitDecision(used <= limitPerMinute, limitPerMinute, Math.max(0, limitPerMinute - used),
                resetSeconds);
    }
}
