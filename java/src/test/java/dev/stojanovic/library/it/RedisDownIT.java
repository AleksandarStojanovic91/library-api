package dev.stojanovic.library.it;

import dev.stojanovic.library.it.support.Api;
import dev.stojanovic.library.it.support.IntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

/** The service with Redis pointed at a closed port: reads, rate limiting and readiness must degrade, not fail. */
@TestPropertySource(properties = "spring.data.redis.url=redis://127.0.0.1:1/0")
class RedisDownIT extends IntegrationTest {

    @Test
    void readsFallBackToTheDatabase() {
        String path = "/api/v1/books/20000000-0000-4000-8000-000000000001";
        Api.Response first = api.get(path).send();
        Api.Response second = api.get(path).send();
        assertThat(first.status()).isEqualTo(200);
        assertThat(second.status()).isEqualTo(200);
        assertThat(second.header("X-Cache")).isEqualTo("MISS");
        assertThat(second.header("RateLimit-Limit")).as("fails open, headers still present").isNotNull();
    }

    @Test
    void readinessReportsRedisDownButStaysReady() {
        Api.Response ready = api.get("/health/ready").send();
        assertThat(ready.status()).isEqualTo(200);
        assertThat(ready.json().get("checks").get("redis").asString()).isEqualTo("DOWN");
        assertThat(ready.json().get("checks").get("db").asString()).isEqualTo("UP");
    }
}
