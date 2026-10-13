package dev.stojanovic.library.adapters.out.cache;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Optional;
import java.util.function.Supplier;

/**
 * A minimal circuit breaker for Redis. Redis is an optimisation here, so after a failure we stop calling it for a
 * few seconds instead of paying a connect timeout on every request, and log once per outage instead of per call.
 */
@Component
class RedisGuard {

    private static final Logger log = LoggerFactory.getLogger(RedisGuard.class);
    private static final long OPEN_NANOS = Duration.ofSeconds(5).toNanos();

    private volatile long openUntil = System.nanoTime();
    private volatile boolean open;

    <T> Optional<T> call(String operation, Supplier<T> action) {
        if (open && System.nanoTime() - openUntil < 0) {
            return Optional.empty();
        }
        try {
            T result = action.get();
            close();
            return Optional.ofNullable(result);
        } catch (RuntimeException e) {
            trip(operation, e);
            return Optional.empty();
        }
    }

    void run(String operation, Runnable action) {
        call(operation, () -> {
            action.run();
            return Boolean.TRUE;
        });
    }

    void close() {
        if (open) {
            open = false;
            log.info("Redis is reachable again; cache and rate limiter re-enabled");
        }
    }

    private void trip(String operation, RuntimeException e) {
        openUntil = System.nanoTime() + OPEN_NANOS;
        if (!open) {
            open = true;
            log.warn("Redis unavailable during {} ({}); serving without cache and rate limits for now",
                    operation, e.getMessage());
        }
    }
}
