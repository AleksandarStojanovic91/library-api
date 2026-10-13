package dev.stojanovic.library.it;

import dev.stojanovic.library.it.support.Api;
import dev.stojanovic.library.it.support.Fixtures;
import dev.stojanovic.library.it.support.IntegrationTest;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/** Races through the real HTTP stack and PostgreSQL; a start latch makes the requests leave together. */
class ConcurrencyIT extends IntegrationTest {

    private static List<Api.Response> race(List<Callable<Api.Response>> requests) throws Exception {
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Api.Response>> futures = new ArrayList<>();
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            for (Callable<Api.Response> request : requests) {
                futures.add(pool.submit(() -> {
                    start.await();
                    return request.call();
                }));
            }
            start.countDown();
            List<Api.Response> responses = new ArrayList<>();
            for (Future<Api.Response> future : futures) {
                responses.add(future.get());
            }
            return responses;
        }
    }

    @Test
    void twentyMembersRaceForTwoCopies() throws Exception {
        Fixtures.Book book = data.book(2);
        List<Fixtures.Member> members = new ArrayList<>();
        for (int i = 0; i < 20; i++) {
            members.add(data.member());
        }

        List<Api.Response> responses = race(members.stream()
                .<Callable<Api.Response>>map(m -> () -> data.borrow(m.token(), book.id())).toList());

        List<Api.Response> created = responses.stream().filter(r -> r.status() == 201).toList();
        assertThat(created).hasSize(2);
        assertThat(created.stream().map(r -> r.json().get("copy").get("id").asString()).collect(Collectors.toSet()))
                .as("never the same copy twice").containsExactlyInAnyOrderElementsOf(book.copyIds());
        assertThat(responses.stream().filter(r -> r.status() != 201))
                .hasSize(18).allSatisfy(r -> assertThat(r.code()).isEqualTo("no-copy-available"));
        assertThat(jdbc.sql("SELECT count(*) FROM loans WHERE book_id = :id AND returned_at IS NULL")
                .param("id", UUID.fromString(book.id())).query(Integer.class).single()).isEqualTo(2);
        assertThat(data.book(book.id()).get("availableCopies").asInt()).isZero();
    }

    @Test
    void oneMemberCannotOutrunTheLoanLimit() throws Exception {
        Fixtures.Member member = data.member(3);
        List<Callable<Api.Response>> borrows = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            String bookId = data.book(1).id();
            borrows.add(() -> data.borrow(member.token(), bookId));
        }

        List<Api.Response> responses = race(borrows);

        assertThat(responses).filteredOn(r -> r.status() == 201).hasSize(3);
        assertThat(responses).filteredOn(r -> r.status() == 409)
                .hasSize(3).allSatisfy(r -> assertThat(r.code()).isEqualTo("loan-limit-reached"));
        assertThat(api.get("/api/v1/members/me").token(member.token()).send().json().get("activeLoans").asInt())
                .isEqualTo(3);
    }

    @Test
    void sameIdempotencyKeySentConcurrentlyCreatesOneLoan() throws Exception {
        Fixtures.Member member = data.member();
        Fixtures.Book book = data.book(3);
        String key = UUID.randomUUID().toString();

        List<Api.Response> responses = race(java.util.stream.IntStream.range(0, 10)
                .<Callable<Api.Response>>mapToObj(i -> () -> data.borrow(member.token(), book.id(), key)).toList());

        assertThat(responses).allSatisfy(r -> assertThat(r.status()).as(r.toString()).isEqualTo(201));
        assertThat(responses.stream().map(Api.Response::id).distinct()).hasSize(1);
        assertThat(responses).filteredOn(r -> "true".equals(r.header("Idempotent-Replayed"))).hasSize(9);
        assertThat(api.get("/api/v1/members/me").token(member.token()).send().json().get("activeLoans").asInt())
                .isEqualTo(1);
        assertThat(data.book(book.id()).get("availableCopies").asInt()).isEqualTo(2);
    }

    @Test
    void concurrentReturnsOfOneLoanSucceedOnce() throws Exception {
        Fixtures.Member member = data.member();
        Fixtures.Book book = data.book(1);
        String loanId = data.borrow(member.token(), book.id()).id();

        List<Api.Response> responses = race(java.util.stream.IntStream.range(0, 5)
                .<Callable<Api.Response>>mapToObj(i -> () -> data.giveBack(member.token(), loanId)).toList());

        assertThat(responses).filteredOn(r -> r.status() == 200).hasSize(1);
        assertThat(responses).filteredOn(r -> r.status() == 409).hasSize(4);
        assertThat(data.book(book.id()).get("availableCopies").asInt()).isEqualTo(1);
    }

    @Test
    void reservationsRacingAReturnNeverStrandAQueue() throws Exception {
        for (int round = 0; round < 5; round++) {
            Fixtures.Book book = data.book(1);
            Fixtures.Member borrower = data.member();
            String loanId = data.borrow(borrower.token(), book.id()).id();
            Fixtures.Member a = data.member();
            Fixtures.Member b = data.member();

            race(List.of(
                    () -> data.giveBack(borrower.token(), loanId),
                    () -> data.reserve(a.token(), book.id()),
                    () -> data.reserve(b.token(), book.id())));

            var reservations = api.get("/api/v1/reservations?bookId=" + book.id()).token(data.librarian()).send()
                    .json().get("data");
            long ready = reservations.findValuesAsString("status").stream().filter("READY"::equals).count();
            long waiting = reservations.findValuesAsString("status").stream().filter("WAITING"::equals).count();
            String copyStatus = data.copyStatus(book.id(), book.copyIds().getFirst());
            if (ready == 1) {
                assertThat(copyStatus).isEqualTo("RESERVED");
            } else {
                assertThat(ready).isZero();
                assertThat(waiting).as("a copy on the shelf while someone waits is a lost hand-off").isZero();
                assertThat(copyStatus).isEqualTo("AVAILABLE");
            }
        }
    }
}
