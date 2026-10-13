package dev.stojanovic.library.it;

import dev.stojanovic.library.it.support.Fixtures;
import dev.stojanovic.library.it.support.IntegrationTest;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class WorkerIT extends IntegrationTest {

    private int count(String sql, UUID id) {
        return jdbc.sql(sql).param("id", id).query(Integer.class).single();
    }

    @Test
    void overdueLoansAreNotifiedExactlyOnce() {
        Fixtures.Member member = data.member();
        UUID loanId = UUID.fromString(data.borrow(member.token(), data.book(1).id()).id());

        worker.runOnce();
        assertThat(count("SELECT count(*) FROM outbox WHERE aggregate_id = :id AND event_type = 'loan.overdue'", loanId))
                .isZero();

        clock.advance(Duration.ofDays(15));
        worker.runOnce();
        worker.runOnce();
        assertThat(count("SELECT count(*) FROM outbox WHERE aggregate_id = :id AND event_type = 'loan.overdue'", loanId))
                .isEqualTo(1);
    }

    @Test
    void outboxEventsBecomeNotificationsForTheMember() {
        Fixtures.Member member = data.member();
        UUID loanId = UUID.fromString(data.borrow(member.token(), data.book(1).id()).id());

        worker.runOnce();

        assertThat(jdbc.sql("""
                        SELECT count(*) FROM notifications n JOIN outbox o ON o.id = n.outbox_id
                        WHERE o.aggregate_id = :id AND n.kind = 'loan.created' AND n.member_id = :member
                          AND o.published_at IS NOT NULL""")
                .param("id", loanId).param("member", UUID.fromString(member.id()))
                .query(Integer.class).single()).isEqualTo(1);
        worker.runOnce();
        assertThat(count("SELECT count(*) FROM notifications n JOIN outbox o ON o.id = n.outbox_id WHERE o.aggregate_id = :id",
                loanId)).as("published once").isEqualTo(1);
    }

    @Test
    void aPoisonMessageIsRetriedWithoutBlockingTheRest() {
        UUID ghost = UUID.randomUUID(); // not a member: the notifications foreign key rejects it
        jdbc.sql("INSERT INTO outbox (aggregate_type, aggregate_id, event_type, payload)"
                        + " VALUES ('loan', :id, 'loan.created', CAST(:payload AS jsonb))")
                .param("id", ghost).param("payload", "{\"memberId\":\"" + ghost + "\"}").update();
        UUID healthy = UUID.fromString(data.borrow(data.member().token(), data.book(1).id()).id());

        worker.runOnce();

        assertThat(count("SELECT attempts FROM outbox WHERE aggregate_id = :id AND published_at IS NULL", ghost))
                .isEqualTo(1);
        assertThat(count("SELECT count(*) FROM outbox WHERE aggregate_id = :id AND published_at IS NOT NULL", healthy))
                .isEqualTo(1);
        jdbc.sql("UPDATE outbox SET attempts = 100 WHERE aggregate_id = :id").param("id", ghost).update(); // park it
    }
}
