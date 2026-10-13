package dev.stojanovic.library.it;

import dev.stojanovic.library.it.support.Api;
import dev.stojanovic.library.it.support.Fixtures;
import dev.stojanovic.library.it.support.IntegrationTest;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class LoansIT extends IntegrationTest {

    @Test
    void borrowAndReturnOnTime() {
        Fixtures.Member member = data.member();
        Fixtures.Book book = data.book(2);

        Api.Response loan = data.borrow(member.token(), book.id());
        assertThat(loan.status()).isEqualTo(201);
        assertThat(loan.header("Location")).isEqualTo("/api/v2/loans/" + loan.id());
        assertThat(loan.header("Deprecation")).isNull();
        assertThat(loan.text("status")).isEqualTo("ACTIVE");
        assertThat(loan.json().get("overdueDays").asInt()).isZero();
        assertThat(loan.json().get("fee").isNull()).isTrue();
        Instant borrowedAt = Instant.parse(loan.text("borrowedAt"));
        assertThat(Duration.between(borrowedAt, Instant.parse(loan.text("dueAt")))).isEqualTo(Duration.ofDays(14));
        String copyId = loan.json().get("copy").get("id").asString();
        assertThat(data.copyStatus(book.id(), copyId)).isEqualTo("ON_LOAN");
        assertThat(data.book(book.id()).get("availableCopies").asInt()).isEqualTo(1);

        Api.Response returned = data.giveBack(member.token(), loan.id());
        assertThat(returned.status()).isEqualTo(200);
        assertThat(returned.text("status")).isEqualTo("RETURNED");
        assertThat(returned.json().get("fee").isNull()).isTrue();
        assertThat(data.copyStatus(book.id(), copyId)).isEqualTo("AVAILABLE");

        Api.Response again = data.giveBack(member.token(), loan.id());
        assertThat(again.status()).isEqualTo(409);
        assertThat(again.code()).isEqualTo("already-returned");
    }

    @Test
    void lateReturnChargesEveryStartedDay() {
        Fixtures.Member member = data.member();
        String loanId = data.borrow(member.token(), data.book(1).id()).id();

        clock.advance(Duration.ofDays(14).plusHours(36)); // 1.5 days late
        JsonNode overdue = api.get("/api/v2/loans/" + loanId).token(member.token()).send().json();
        assertThat(overdue.get("status").asString()).isEqualTo("OVERDUE");
        assertThat(overdue.get("overdueDays").asInt()).isEqualTo(1);
        assertThat(overdue.get("fee").get("amount").asString()).isEqualTo("1.00");
        assertThat(overdue.get("fee").get("currency").asString()).isEqualTo("EUR");
        JsonNode overdueV1 = api.get("/api/v1/loans/" + loanId).token(member.token()).send().json();
        assertThat(overdueV1.get("feeCents").isNull()).as("v1 shows the fee only once returned").isTrue();

        JsonNode returned = api.post("/api/v1/loans/" + loanId + "/return").token(member.token()).send().json();
        assertThat(returned.get("status").asString()).isEqualTo("RETURNED");
        assertThat(returned.get("feeCents").asInt()).isEqualTo(100);

        clock.advance(Duration.ofDays(30)); // a returned loan's numbers are frozen at return time
        JsonNode later = api.get("/api/v2/loans/" + loanId).token(member.token()).send().json();
        assertThat(later.get("overdueDays").asInt()).isEqualTo(1);
        assertThat(later.get("fee").get("amount").asString()).isEqualTo("1.00");
    }

    @Test
    void statusFilterIsEvaluatedAgainstTheBusinessClock() {
        Fixtures.Member member = data.member();
        String kept = data.borrow(member.token(), data.book(1).id()).id();
        String returned = data.borrow(member.token(), data.book(1).id()).id();
        data.giveBack(member.token(), returned);

        assertThat(ids(member, "ACTIVE")).containsExactly(kept);
        assertThat(ids(member, "RETURNED")).containsExactly(returned);
        assertThat(ids(member, "OVERDUE")).isEmpty();

        clock.advance(Duration.ofDays(15));
        assertThat(ids(member, "OVERDUE")).containsExactly(kept);
        assertThat(ids(member, "ACTIVE")).isEmpty();

        assertThat(api.get("/api/v2/loans?status=LOST").token(member.token()).send().status()).isEqualTo(400);
    }

    private java.util.List<String> ids(Fixtures.Member member, String status) {
        return Fixtures.ids(api.get("/api/v2/loans?status=" + status).token(member.token()).send().json());
    }

    @Test
    void loanLimitIsEnforced() {
        Fixtures.Member member = data.member(2);
        String first = data.borrow(member.token(), data.book(1).id()).id();
        data.borrow(member.token(), data.book(1).id());

        Api.Response third = data.borrow(member.token(), data.book(1).id());
        assertThat(third.status()).isEqualTo(409);
        assertThat(third.code()).isEqualTo("loan-limit-reached");

        data.giveBack(member.token(), first);
        assertThat(data.borrow(member.token(), data.book(1).id()).status()).isEqualTo(201);
    }

    @Test
    void noCopyAvailableSuggestsAReservation() {
        Fixtures.Book book = data.book(1);
        data.borrow(data.member().token(), book.id());

        Api.Response response = data.borrow(data.member().token(), book.id());
        assertThat(response.status()).isEqualTo(409);
        assertThat(response.code()).isEqualTo("no-copy-available");
        assertThat(response.text("detail"))
                .isEqualTo("No copy of this book is available. You can reserve it with POST /api/v1/reservations.");
    }

    @Test
    void borrowValidation() {
        Fixtures.Member member = data.member();
        assertThat(data.borrow(member.token(), Fixtures.MISSING_ID).status()).isEqualTo(404);

        Api.Response badId = api.post("/api/v2/loans").token(member.token())
                .header("Idempotency-Key", UUID.randomUUID().toString()).json(Map.of("bookId", "nope")).send();
        assertThat(badId.json().get("errors").findValuesAsString("field")).containsExactly("bookId");

        Api.Response noKey = api.post("/api/v2/loans").token(member.token())
                .json(Map.of("bookId", data.book(1).id())).send();
        assertThat(noKey.status()).isEqualTo(400);
        assertThat(api.get("/api/v1/members/me").token(member.token()).send().json().get("activeLoans").asInt()).isZero();
    }

    @Test
    void v1IsDeprecatedAndHasTheOldShape() {
        Fixtures.Member member = data.member();
        Api.Response v1 = api.post("/api/v1/loans").token(member.token())
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .json(Map.of("bookId", data.book(1).id())).send();

        assertThat(v1.status()).isEqualTo(201);
        assertThat(v1.header("Location")).isEqualTo("/api/v1/loans/" + v1.id());
        assertThat(v1.json().has("bookId")).isTrue();
        assertThat(v1.json().has("book")).isFalse();
        assertDeprecated(v1);

        assertDeprecated(api.get("/api/v1/loans").token(member.token()).send());
        assertDeprecated(api.get("/api/v1/loans/" + Fixtures.MISSING_ID).token(member.token()).send());
        assertDeprecated(api.get("/api/v1/loans").send()); // 401 too
        Api.Response v2 = api.get("/api/v2/loans/" + v1.id()).token(member.token()).send();
        assertThat(v2.header("Deprecation")).isNull();
        assertThat(v2.text("borrowedAt")).isEqualTo(v1.text("borrowedAt"));
    }

    private static void assertDeprecated(Api.Response response) {
        assertThat(response.header("Deprecation")).as(response.toString()).isEqualTo("@1767225600");
        assertThat(response.header("Sunset")).isEqualTo("Thu, 31 Dec 2026 23:59:59 GMT");
        assertThat(response.header("Link")).isEqualTo("</api/v2/loans>; rel=\"successor-version\"");
    }

    @Test
    void borrowingAndReturningEvictTheCachedBook() {
        Fixtures.Member member = data.member();
        Fixtures.Book book = data.book(1);
        data.book(book.id());
        assertThat(api.get("/api/v1/books/" + book.id()).send().header("X-Cache")).isEqualTo("HIT");

        String loanId = data.borrow(member.token(), book.id()).id();
        Api.Response afterBorrow = api.get("/api/v1/books/" + book.id()).send();
        assertThat(afterBorrow.header("X-Cache")).isEqualTo("MISS");
        assertThat(afterBorrow.json().get("availableCopies").asInt()).isZero();

        data.giveBack(member.token(), loanId);
        assertThat(data.book(book.id()).get("availableCopies").asInt()).isEqualTo(1);
    }
}
