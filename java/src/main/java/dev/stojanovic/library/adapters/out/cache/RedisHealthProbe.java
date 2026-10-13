package dev.stojanovic.library.adapters.out.cache;

import dev.stojanovic.library.application.port.out.HealthProbe;
import org.springframework.core.annotation.Order;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

@Component
@Order(2)
class RedisHealthProbe implements HealthProbe {

    private final StringRedisTemplate redis;
    private final RedisGuard guard;

    RedisHealthProbe(StringRedisTemplate redis, RedisGuard guard) {
        this.redis = redis;
        this.guard = guard;
    }

    @Override
    public String name() {
        return "redis";
    }

    /** The service degrades gracefully without Redis (no cache, no rate limits), so it stays ready. */
    @Override
    public boolean optional() {
        return true;
    }

    /** Always pings for real (bypassing the circuit), and closes the circuit early when Redis is back. */
    @Override
    public boolean isUp() {
        try {
            boolean up = "PONG".equalsIgnoreCase(redis.execute((RedisCallback<String>) RedisConnection::ping));
            if (up) {
                guard.close();
            }
            return up;
        } catch (RuntimeException e) {
            return false;
        }
    }
}
