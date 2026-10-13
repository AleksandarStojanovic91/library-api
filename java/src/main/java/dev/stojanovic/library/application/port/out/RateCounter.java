package dev.stojanovic.library.application.port.out;

import java.time.Duration;
import java.util.OptionalLong;

public interface RateCounter {

    /** Atomically increments the counter, setting its TTL on first use; empty if the store is unavailable. */
    OptionalLong increment(String key, Duration ttl);
}
