package dev.stojanovic.library.adapters.out.persistence;

import dev.stojanovic.library.application.model.ReservationQuery;
import dev.stojanovic.library.application.model.ReservationView;
import dev.stojanovic.library.application.page.Page;
import dev.stojanovic.library.application.page.PageRequest;
import dev.stojanovic.library.application.port.out.ReservationRepository;
import dev.stojanovic.library.domain.error.ErrorKind;
import dev.stojanovic.library.domain.error.LibraryException;
import dev.stojanovic.library.domain.model.Reservation;
import dev.stojanovic.library.domain.model.ReservationStatus;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static dev.stojanovic.library.adapters.out.persistence.Sql.instant;
import static dev.stojanovic.library.adapters.out.persistence.Sql.nullableInt;
import static dev.stojanovic.library.adapters.out.persistence.Sql.ts;
import static dev.stojanovic.library.adapters.out.persistence.Sql.uuid;

@Repository
class JdbcReservationRepository implements ReservationRepository {

    private static final String COLUMNS =
            "r.id, r.book_id, r.member_id, r.status, r.held_copy_id, r.ready_until, r.created_at";

    /** Queue position = 1 + WAITING reservations for the same book that are ahead in (created_at, id) order. */
    private static final String VIEW = "SELECT " + COLUMNS + """
            , CASE WHEN r.status = 'WAITING' THEN 1 + (
                  SELECT count(*) FROM reservations w
                  WHERE w.book_id = r.book_id AND w.status = 'WAITING' AND (w.created_at, w.id) < (r.created_at, r.id)
              ) END AS position
            FROM reservations r""";

    private static final RowMapper<Reservation> RESERVATION = (rs, n) -> new Reservation(uuid(rs, "id"),
            uuid(rs, "book_id"), uuid(rs, "member_id"), ReservationStatus.valueOf(rs.getString("status")),
            uuid(rs, "held_copy_id"), instant(rs, "ready_until"), instant(rs, "created_at"));

    private static final RowMapper<ReservationView> RESERVATION_VIEW = (rs, n) -> new ReservationView(uuid(rs, "id"),
            uuid(rs, "book_id"), uuid(rs, "member_id"), ReservationStatus.valueOf(rs.getString("status")),
            nullableInt(rs, "position"), uuid(rs, "held_copy_id"), instant(rs, "ready_until"),
            instant(rs, "created_at"));

    private final JdbcClient jdbc;

    JdbcReservationRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public UUID insert(UUID bookId, UUID memberId) {
        try {
            return jdbc.sql("INSERT INTO reservations (book_id, member_id) VALUES (:bookId, :memberId) RETURNING id")
                    .param("bookId", bookId).param("memberId", memberId).query(UUID.class).single();
        } catch (DuplicateKeyException e) {
            throw new LibraryException(ErrorKind.ALREADY_RESERVED,
                    "You already have an open reservation for this book");
        }
    }

    @Override
    public boolean hasOpen(UUID memberId, UUID bookId) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM reservations"
                        + " WHERE member_id = :memberId AND book_id = :bookId AND status IN ('WAITING', 'READY'))")
                .param("memberId", memberId).param("bookId", bookId).query(Boolean.class).single();
    }

    @Override
    public Optional<Reservation> lockReadyFor(UUID memberId, UUID bookId, Instant now) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM reservations r WHERE r.member_id = :memberId"
                        + " AND r.book_id = :bookId AND r.status = 'READY' AND r.ready_until > :now FOR UPDATE")
                .param("memberId", memberId).param("bookId", bookId).param("now", ts(now))
                .query(RESERVATION).optional();
    }

    @Override
    public Optional<UUID> findBookId(UUID reservationId) {
        return jdbc.sql("SELECT book_id FROM reservations WHERE id = :id").param("id", reservationId)
                .query(UUID.class).optional();
    }

    @Override
    public Optional<Reservation> lockById(UUID id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM reservations r WHERE r.id = :id FOR UPDATE").param("id", id)
                .query(RESERVATION).optional();
    }

    @Override
    public Optional<Reservation> lockNextWaiting(UUID bookId) {
        // SKIP LOCKED: when two copies of a book come back at once, the second return serves the second in line
        // instead of waiting for the first and then finding nobody (LIMIT 1 + FOR UPDATE would return no row).
        return jdbc.sql("SELECT " + COLUMNS + " FROM reservations r WHERE r.book_id = :bookId AND r.status = 'WAITING'"
                        + " ORDER BY r.created_at, r.id LIMIT 1 FOR UPDATE SKIP LOCKED")
                .param("bookId", bookId).query(RESERVATION).optional();
    }

    @Override
    public List<Reservation> findExpired(Instant now, int batchSize) {
        // ordered by book so every worker takes book locks in the same order
        return jdbc.sql("SELECT " + COLUMNS + " FROM reservations r WHERE r.status = 'READY' AND r.ready_until < :now"
                        + " ORDER BY r.book_id, r.id LIMIT :batch")
                .param("now", ts(now)).param("batch", batchSize).query(RESERVATION).list();
    }

    @Override
    public void markReady(UUID id, UUID copyId, Instant readyUntil) {
        jdbc.sql("UPDATE reservations SET status = 'READY', held_copy_id = :copyId, ready_until = :readyUntil,"
                        + " updated_at = now() WHERE id = :id")
                .param("id", id).param("copyId", copyId).param("readyUntil", ts(readyUntil)).update();
    }

    @Override
    public void close(UUID id, ReservationStatus finalStatus) {
        if (finalStatus.isOpen()) {
            throw new IllegalArgumentException("Not a final status: " + finalStatus);
        }
        // held_copy_id must be cleared: the schema ties "READY" to "has a held copy"
        jdbc.sql("UPDATE reservations SET status = :status, held_copy_id = NULL, updated_at = now() WHERE id = :id")
                .param("id", id).param("status", finalStatus.name()).update();
    }

    @Override
    public Optional<ReservationView> findView(UUID id) {
        return jdbc.sql(VIEW + " WHERE r.id = :id").param("id", id).query(RESERVATION_VIEW).optional();
    }

    @Override
    public Page<ReservationView> list(ReservationQuery query, PageRequest page) {
        Where where = new Where();
        if (query.memberId() != null) {
            where.and("r.member_id = :memberId").param("memberId", query.memberId());
        }
        if (query.bookId() != null) {
            where.and("r.book_id = :bookId").param("bookId", query.bookId());
        }
        Keyset.afterCreatedAt(where, "r.", page.after());
        var rows = jdbc.sql(VIEW + where.sql() + " ORDER BY r.created_at, r.id LIMIT :limit")
                .params(where.params())
                .param("limit", page.fetchSize())
                .query(RESERVATION_VIEW)
                .list();
        return Page.fromOverfetch(rows, page, r -> Keyset.createdAtCursor(r.createdAt(), r.id()));
    }
}
