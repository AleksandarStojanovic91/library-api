package dev.stojanovic.library.application;

import dev.stojanovic.library.application.model.RateLimitDecision;
import dev.stojanovic.library.application.port.out.RateCounter;
import dev.stojanovic.library.application.service.RateLimitService;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.OptionalLong;

import static org.assertj.core.api.Assertions.assertThat;

class RateLimitServiceTest {

    /** 20 s into a minute. */
    private static final Instant NOW = Instant.parse("2026-10-13T09:15:20Z");
    private final Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);

    private static class InMemoryCounter implements RateCounter {
        final Map<String, Long> counts = new HashMap<>();
        final List<Duration> ttls = new ArrayList<>();

        @Override
        public OptionalLong increment(String key, Duration ttl) {
            ttls.add(ttl);
            return OptionalLong.of(counts.merge(key, 1L, Long::sum));
        }
    }

    @Test
    void countsPerClientAndMinuteAndBlocksAboveTheLimit() {
        InMemoryCounter counter = new InMemoryCounter();
        RateLimitService limiter = new RateLimitService(counter, clock, "rl", 2);

        RateLimitDecision first = limiter.check("member-1");
        RateLimitDecision second = limiter.check("member-1");
        RateLimitDecision third = limiter.check("member-1");
        RateLimitDecision otherClient = limiter.check("10.0.0.7");

        assertThat(first).isEqualTo(new RateLimitDecision(true, 2, 1, 40));
        assertThat(second).isEqualTo(new RateLimitDecision(true, 2, 0, 40));
        assertThat(third).isEqualTo(new RateLimitDecision(false, 2, 0, 40));
        assertThat(otherClient.allowed()).isTrue();
        assertThat(counter.counts).containsOnlyKeys("rl:member-1:" + NOW.getEpochSecond() / 60,
                "rl:10.0.0.7:" + NOW.getEpochSecond() / 60);
    }

    @Test
    void failsOpenWhenTheCounterIsUnavailable() {
        RateLimitService limiter = new RateLimitService((key, ttl) -> OptionalLong.empty(), clock, "rl", 5);
        assertThat(limiter.check("anyone")).isEqualTo(new RateLimitDecision(true, 5, 5, 40));
    }

    @Test
    void resetIsAFullMinuteAtTheStartOfAWindow() {
        Clock windowStart = Clock.fixed(Instant.parse("2026-10-13T09:16:00Z"), ZoneOffset.UTC);
        RateLimitService limiter = new RateLimitService(new InMemoryCounter(), windowStart, "rl", 5);
        assertThat(limiter.check("x").resetSeconds()).isEqualTo(60);
    }

    @Test
    void namespaceSeparatesInstancesSharingOneRedis() {
        InMemoryCounter counter = new InMemoryCounter();
        new RateLimitService(counter, clock, "rl", 5).check("member-1");
        new RateLimitService(counter, clock, "rl-future", 5).check("member-1");
        long minute = NOW.getEpochSecond() / 60;
        assertThat(counter.counts).containsOnlyKeys("rl:member-1:" + minute, "rl-future:member-1:" + minute)
                .allSatisfy((key, count) -> assertThat(count).isEqualTo(1L));
    }
}
