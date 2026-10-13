package dev.stojanovic.library.it;

import dev.stojanovic.library.it.support.Api;
import dev.stojanovic.library.it.support.Fixtures;
import dev.stojanovic.library.it.support.IntegrationTest;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

class ReservationsIT extends IntegrationTest {

    @Test
    void noCopyThenReservationThenHoldThenBorrow() {
        Fixtures.Book book = data.book(1);
        String copyId = book.copyIds().getFirst();
        Fixtures.Member borrower = data.member();
        Fixtures.Member first = data.member();
        Fixtures.Member second = data.member();
        String loanId = data.borrow(borrower.token(), book.id()).id();

        assertThat(data.borrow(first.token(), book.id()).code()).isEqualTo("no-copy-available");
        Api.Response r1 = data.reserve(first.token(), book.id());
        Api.Response r2 = data.reserve(second.token(), book.id());
        assertThat(r1.status()).isEqualTo(201);
        assertThat(r1.header("Location")).isEqualTo("/api/v1/reservations/" + r1.id());
        assertThat(r1.json().get("position").asInt()).isEqualTo(1);
        assertThat(r2.json().get("position").asInt()).isEqualTo(2);
        assertThat(data.reserve(first.token(), book.id()).code()).isEqualTo("already-reserved");

        data.giveBack(borrower.token(), loanId);

        JsonNode ready = data.reservation(book.id(), r1.id());
        assertThat(ready.get("status").asString()).isEqualTo("READY");
        assertThat(ready.get("heldCopyId").asString()).isEqualTo(copyId);
        assertThat(ready.get("position").isNull()).isTrue();
        assertThat(Instant.parse(ready.get("readyUntil").asString()))
                .isCloseTo(Instant.now().plus(Duration.ofHours(48)), within(Duration.ofMinutes(5)));
        assertThat(data.reservation(book.id(), r2.id()).get("position").asInt()).isEqualTo(1);
        assertThat(data.copyStatus(book.id(), copyId)).isEqualTo("RESERVED");
        assertThat(data.book(book.id()).get("availableCopies").asInt()).isZero();

        assertThat(data.borrow(second.token(), book.id()).code()).as("only the holder may take the copy")
                .isEqualTo("no-copy-available");
        Api.Response collected = data.borrow(first.token(), book.id());
        assertThat(collected.status()).isEqualTo(201);
        assertThat(collected.json().get("copy").get("id").asString()).isEqualTo(copyId);
        assertThat(data.reservation(book.id(), r1.id()).get("status").asString()).isEqualTo("FULFILLED");
        assertThat(api.delete("/api/v1/reservations/" + r1.id()).token(first.token()).send().code())
                .isEqualTo("reservation-not-cancellable");
    }

    @Test
    void cannotReserveWhileACopyIsAvailable() {
        Api.Response response = data.reserve(data.member().token(), data.book(1).id());
        assertThat(response.status()).isEqualTo(409);
        assertThat(response.code()).isEqualTo("copy-available");
    }

    @Test
    void cancellingAReadyHoldPassesTheCopyOn() {
        Fixtures.Book book = data.book(1);
        Fixtures.Member borrower = data.member();
        Fixtures.Member first = data.member();
        Fixtures.Member second = data.member();
        String loanId = data.borrow(borrower.token(), book.id()).id();
        String r1 = data.reserve(first.token(), book.id()).id();
        String r2 = data.reserve(second.token(), book.id()).id();
        data.giveBack(borrower.token(), loanId);

        assertThat(api.delete("/api/v1/reservations/" + r1).token(data.member().token()).send().status())
                .as("someone else's reservation").isEqualTo(404);
        assertThat(api.delete("/api/v1/reservations/" + r1).token(first.token()).send().status()).isEqualTo(204);
        JsonNode next = data.reservation(book.id(), r2);
        assertThat(next.get("status").asString()).isEqualTo("READY");
        assertThat(next.get("heldCopyId").asString()).isEqualTo(book.copyIds().getFirst());

        assertThat(api.delete("/api/v1/reservations/" + r2).token(data.librarian()).send().status()).isEqualTo(204);
        assertThat(data.copyStatus(book.id(), book.copyIds().getFirst())).isEqualTo("AVAILABLE");
        assertThat(data.book(book.id()).get("availableCopies").asInt()).isEqualTo(1);
    }

    @Test
    void expiredHoldsArePassedOnByTheWorker() {
        Fixtures.Book book = data.book(1);
        Fixtures.Member borrower = data.member();
        Fixtures.Member first = data.member();
        Fixtures.Member second = data.member();
        String loanId = data.borrow(borrower.token(), book.id()).id();
        String r1 = data.reserve(first.token(), book.id()).id();
        String r2 = data.reserve(second.token(), book.id()).id();
        data.giveBack(borrower.token(), loanId);

        clock.advance(Duration.ofHours(49));
        worker.runOnce();

        assertThat(data.reservation(book.id(), r1).get("status").asString()).isEqualTo("EXPIRED");
        JsonNode next = data.reservation(book.id(), r2);
        assertThat(next.get("status").asString()).isEqualTo("READY");
        assertThat(Instant.parse(next.get("readyUntil").asString())).isAfter(clock.instant().plus(Duration.ofHours(47)));
        assertThat(jdbc.sql("SELECT count(*) FROM outbox WHERE aggregate_id = :id AND event_type = 'reservation.expired'")
                .param("id", java.util.UUID.fromString(r1)).query(Integer.class).single()).isEqualTo(1);

        data.book(book.id()); // cache the book with 0 available
        clock.advance(Duration.ofHours(49));
        worker.runOnce();
        assertThat(data.reservation(book.id(), r2).get("status").asString()).isEqualTo("EXPIRED");
        assertThat(data.book(book.id()).get("availableCopies").asInt()).as("the worker evicts the cache").isEqualTo(1);
    }

    @Test
    void holderGetsTheHeldCopyEvenWhenAnotherIsAvailable() {
        Fixtures.Book book = data.book(1);
        Fixtures.Member borrower = data.member();
        Fixtures.Member holder = data.member();
        String loanId = data.borrow(borrower.token(), book.id()).id();
        data.reserve(holder.token(), book.id());
        data.giveBack(borrower.token(), loanId);
        data.addCopy(book.id());

        Api.Response loan = data.borrow(holder.token(), book.id());
        assertThat(loan.json().get("copy").get("id").asString()).isEqualTo(book.copyIds().getFirst());
        assertThat(data.book(book.id()).get("availableCopies").asInt()).isEqualTo(1);
    }
}
