package dev.stojanovic.library.it;

import dev.stojanovic.library.it.support.Api;
import dev.stojanovic.library.it.support.Fixtures;
import dev.stojanovic.library.it.support.IntegrationTest;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class IdempotencyIT extends IntegrationTest {

    @Test
    void sameKeyAndBodyReplaysTheFirstResponse() {
        Fixtures.Member member = data.member();
        Fixtures.Book book = data.book(2);
        String key = UUID.randomUUID().toString();

        Api.Response first = data.borrow(member.token(), book.id(), key);
        Api.Response replay = api.post("/api/v2/loans").token(member.token()).header("Idempotency-Key", key)
                .json("{ \"bookId\" : \"" + book.id() + "\", \"memberId\": null }").send(); // same request, other bytes

        assertThat(first.header("Idempotent-Replayed")).isNull();
        assertThat(replay.status()).isEqualTo(201);
        assertThat(replay.header("Idempotent-Replayed")).isEqualTo("true");
        assertThat(replay.header("Location")).isEqualTo(first.header("Location"));
        assertThat(replay.json()).isEqualTo(first.json());

        data.giveBack(member.token(), first.id());
        Api.Response afterReturn = data.borrow(member.token(), book.id(), key);
        assertThat(afterReturn.text("status")).as("a replay returns the stored response").isEqualTo("ACTIVE");
        assertThat(jdbc.sql("SELECT count(*) FROM loans WHERE member_id = :id")
                .param("id", UUID.fromString(member.id())).query(Integer.class).single()).isEqualTo(1);
    }

    @Test
    void reusingAKeyForADifferentRequestIsRejected() {
        Fixtures.Member member = data.member();
        String key = UUID.randomUUID().toString();
        data.borrow(member.token(), data.book(1).id(), key);

        Api.Response otherBook = data.borrow(member.token(), data.book(1).id(), key);
        assertThat(otherBook.status()).isEqualTo(422);
        assertThat(otherBook.code()).isEqualTo("idempotency-key-reused");

        Api.Response otherVersion = api.post("/api/v1/loans").token(member.token()).header("Idempotency-Key", key)
                .json(Map.of("bookId", data.book(1).id())).send();
        assertThat(otherVersion.status()).as("the path is part of the request hash").isEqualTo(422);
    }

    @Test
    void keysAreScopedPerMember() {
        Fixtures.Book book = data.book(2);
        String key = UUID.randomUUID().toString();
        Api.Response a = data.borrow(data.member().token(), book.id(), key);
        Api.Response b = data.borrow(data.member().token(), book.id(), key);
        assertThat(b.status()).isEqualTo(201);
        assertThat(b.header("Idempotent-Replayed")).isNull();
        assertThat(b.id()).isNotEqualTo(a.id());
    }

    @Test
    void businessErrorsAreStoredAndReplayed() {
        Fixtures.Member member = data.member();
        Fixtures.Book book = data.book(0);
        String key = UUID.randomUUID().toString();

        Api.Response first = data.borrow(member.token(), book.id(), key);
        assertThat(first.code()).isEqualTo("no-copy-available");

        data.addCopy(book.id());
        Api.Response replay = data.borrow(member.token(), book.id(), key);
        assertThat(replay.status()).isEqualTo(409);
        assertThat(replay.code()).isEqualTo("no-copy-available");
        assertThat(replay.header("Idempotent-Replayed")).isEqualTo("true");
        assertThat(replay.text("requestId")).as("the replayed problem answers this request")
                .isEqualTo(replay.header("X-Request-Id"));

        assertThat(data.borrow(member.token(), book.id()).status()).as("a new key does new work").isEqualTo(201);
    }

    @Test
    void keyIsRequiredAndBounded() {
        Fixtures.Member member = data.member();
        Fixtures.Book book = data.book(1);
        Api.Response missing = api.post("/api/v2/loans").token(member.token()).json(Map.of("bookId", book.id())).send();
        assertThat(missing.json().get("errors").findValuesAsString("field")).containsExactly("Idempotency-Key");
        assertThat(data.borrow(member.token(), book.id(), "short").status()).isEqualTo(400);
        assertThat(data.borrow(member.token(), book.id(), "k".repeat(101)).status()).isEqualTo(400);
    }

    @Test
    void keysOlderThanADayAreDeletedByTheWorker() {
        Fixtures.Member member = data.member();
        String key = UUID.randomUUID().toString();
        data.borrow(member.token(), data.book(1).id(), key);
        jdbc.sql("UPDATE idempotency_keys SET created_at = now() - interval '25 hours' WHERE key = :key")
                .param("key", key).update();

        worker.runOnce();

        assertThat(jdbc.sql("SELECT count(*) FROM idempotency_keys WHERE key = :key").param("key", key)
                .query(Integer.class).single()).isZero();
    }
}
