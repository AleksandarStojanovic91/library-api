package dev.stojanovic.library.adapters.out.cache;

import dev.stojanovic.library.application.port.out.RateCounter;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;
import java.util.OptionalLong;

@Component
class RedisRateCounter implements RateCounter {

    /** INCR and EXPIRE in one atomic step, so a crash between them can never leave a counter without a TTL. */
    private static final RedisScript<Long> INCREMENT = RedisScript.of("""
            local count = redis.call('INCR', KEYS[1])
            if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
            return count""", Long.class);

    private final StringRedisTemplate redis;
    private final RedisGuard guard;

    RedisRateCounter(StringRedisTemplate redis, RedisGuard guard) {
        this.redis = redis;
        this.guard = guard;
    }

    @Override
    public OptionalLong increment(String key, Duration ttl) {
        return guard.call("rate limit", () -> redis.execute(INCREMENT, List.of(key), Long.toString(ttl.toSeconds())))
                .map(OptionalLong::of)
                .orElseGet(OptionalLong::empty);
    }
}
