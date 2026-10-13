package dev.stojanovic.library.application.port.out;

import dev.stojanovic.library.application.model.ReservationQuery;
import dev.stojanovic.library.application.model.ReservationView;
import dev.stojanovic.library.application.page.Page;
import dev.stojanovic.library.application.page.PageRequest;
import dev.stojanovic.library.domain.model.Reservation;
import dev.stojanovic.library.domain.model.ReservationStatus;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ReservationRepository {

    /** Inserts a WAITING reservation; a second open one for the same member and book is {@code ALREADY_RESERVED}. */
    UUID insert(UUID bookId, UUID memberId);

    boolean hasOpen(UUID memberId, UUID bookId);

    /** The member's READY reservation for the book that is still within its hold, locked. */
    Optional<Reservation> lockReadyFor(UUID memberId, UUID bookId, Instant now);

    /** Unlocked read, used to find which book to lock first (lock order: book before reservation). */
    Optional<UUID> findBookId(UUID reservationId);

    Optional<Reservation> lockById(UUID id);

    /** Head of the FIFO queue for the book, locked; rows locked by others are skipped. */
    Optional<Reservation> lockNextWaiting(UUID bookId);

    /** Candidates for expiry (READY, hold ended before {@code now}), unlocked and ordered by book. */
    List<Reservation> findExpired(Instant now, int batchSize);

    void markReady(UUID id, UUID copyId, Instant readyUntil);

    /** Moves an open reservation to a final status and releases its held copy reference. */
    void close(UUID id, ReservationStatus finalStatus);

    Optional<ReservationView> findView(UUID id);

    Page<ReservationView> list(ReservationQuery query, PageRequest page);
}
