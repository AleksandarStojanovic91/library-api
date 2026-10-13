package dev.stojanovic.library.it;

import dev.stojanovic.library.application.model.MemberCredentials;
import dev.stojanovic.library.application.port.out.TokenIssuer;
import dev.stojanovic.library.domain.model.Role;
import dev.stojanovic.library.it.support.Api;
import dev.stojanovic.library.it.support.IntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@TestPropertySource(properties = "library.rate-limit-per-minute=5")
class RateLimitIT extends IntegrationTest {

    @Autowired
    private TokenIssuer tokens;

    @Test
    void the429CarriesRetryAfterAndHealthStaysOpen() {
        // Issued directly: logging in is anonymous, and the IP bucket is shared with every other test class.
        String token = tokens.issue(new MemberCredentials(UUID.fromString("00000000-0000-4000-8000-000000000003"),
                "member2@library.test", Role.MEMBER, "")).accessToken();
        Api.Response last = null;
        for (int i = 0; i < 7 && (last == null || last.status() != 429); i++) {
            last = api.get("/api/v1/members/me").token(token).send();
        }
        assertThat(last.status()).isEqualTo(429);
        assertThat(last.code()).isEqualTo("rate-limited");
        assertThat(last.header("RateLimit-Remaining")).isEqualTo("0");
        assertThat(Integer.parseInt(last.header("Retry-After"))).isBetween(0, 60);

        assertThat(api.get("/health/live").token(token).send().status()).isEqualTo(200);
        assertThat(api.get("/metrics").token(token).send().status()).isEqualTo(200);
    }
}
