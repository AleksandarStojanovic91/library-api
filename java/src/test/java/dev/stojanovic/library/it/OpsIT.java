package dev.stojanovic.library.it;

import dev.stojanovic.library.it.support.Api;
import dev.stojanovic.library.it.support.Fixtures;
import dev.stojanovic.library.it.support.IntegrationTest;
import org.junit.jupiter.api.Test;

import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThat;

class OpsIT extends IntegrationTest {

    @Test
    void healthProbes() {
        Api.Response live = api.get("/health/live").send();
        assertThat(live.json().toString()).isEqualTo("{\"status\":\"UP\"}");
        Api.Response ready = api.get("/health/ready").send();
        assertThat(ready.status()).isEqualTo(200);
        assertThat(ready.json().get("checks").get("db").asString()).isEqualTo("UP");
        assertThat(ready.json().get("checks").get("redis").asString()).isEqualTo("UP");
        assertThat(live.header("RateLimit-Limit")).as("health is not rate limited").isNull();
    }

    @Test
    void requestIdIsEchoedWhenWellFormedAndGeneratedOtherwise() {
        Api.Response echoed = api.get("/api/v1/books/" + Fixtures.MISSING_ID).header("X-Request-Id", "trace-me_0123456789").send();
        assertThat(echoed.header("X-Request-Id")).isEqualTo("trace-me_0123456789");
        assertThat(echoed.text("requestId")).isEqualTo("trace-me_0123456789");

        for (String bad : new String[]{"abc1234", "a".repeat(101), "bad id; drop table"}) {
            String generated = api.get("/health/live").header("X-Request-Id", bad).send().header("X-Request-Id");
            assertThat(generated).matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
        }
    }

    @Test
    void rateLimitHeadersCountDown() {
        String token = data.member().token();
        Api.Response first = api.get("/api/v1/members/me").token(token).send();
        Api.Response second = api.get("/api/v1/members/me").token(token).send();
        long remaining = Long.parseLong(first.header("RateLimit-Remaining"));
        assertThat(Long.parseLong(second.header("RateLimit-Remaining"))).isIn(remaining - 1, Long.parseLong(second.header("RateLimit-Limit")) - 1);
        assertThat(Long.parseLong(first.header("RateLimit-Reset"))).isBetween(0L, 60L);
    }

    @Test
    void prometheusMetricsUseTheSpecNames() {
        Fixtures.Member member = data.member();
        String loanId = data.borrow(member.token(), data.book(1).id()).id();
        data.giveBack(member.token(), loanId);
        worker.runOnce();

        Api.Response metrics = api.get("/metrics").header("Accept", "text/plain").send();
        assertThat(metrics.status()).isEqualTo(200);
        assertThat(metrics.header("Content-Type")).startsWith("text/plain");
        String[] lines = metrics.body().split("\n");
        for (String name : new String[]{"library_loans_borrowed_total", "library_loans_returned_total",
                "library_outbox_backlog", "http_server_requests_seconds_bucket{"}) {
            assertThat(Arrays.stream(lines).anyMatch(l -> l.startsWith(name))).as(name).isTrue();
        }
        assertThat(metrics.body()).contains("uri=\"/api/v2/loans/{loanId}/return\"");
    }

    @Test
    void servesTheSharedContractAndSwaggerUi() {
        Api.Response yaml = api.get("/openapi.yaml").send();
        assertThat(yaml.status()).isEqualTo(200);
        assertThat(yaml.body()).startsWith("openapi: 3.1.0");
        Api.Response docs = api.get("/docs").send();
        assertThat(docs.header("Content-Type")).startsWith("text/html");
        assertThat(docs.body()).containsIgnoringCase("swagger").contains("/openapi.yaml");
    }

    @Test
    void unsupportedRequestsAreProblemsWithoutInternals() {
        Api.Response response = api.post("/api/v1/books").token(data.librarian())
                .header("Content-Type", "text/plain").json("isbn=1").send();
        assertThat(response.status()).as("no code for 415, so validation-failed keeps its 400").isEqualTo(400);
        assertThat(response.body()).doesNotContain("Exception", "at org.");

        Api.Response wrongMethod = api.put("/api/v1/books").json("{}").send();
        assertThat(wrongMethod.status()).isEqualTo(404);
        assertThat(wrongMethod.header("Allow")).contains("GET", "POST");
    }
}
