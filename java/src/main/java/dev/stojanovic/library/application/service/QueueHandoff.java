package dev.stojanovic.library.application.service;

import dev.stojanovic.library.application.model.OutboxEvent;
import dev.stojanovic.library.application.port.out.BookCache;
import dev.stojanovic.library.application.port.out.CopyRepository;
import dev.stojanovic.library.application.port.out.OutboxRepository;
import dev.stojanovic.library.application.port.out.ReservationRepository;
import dev.stojanovic.library.domain.model.CopyStatus;
import dev.stojanovic.library.domain.model.Reservation;
import dev.stojanovic.library.domain.policy.ReservationPolicy;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * What happens to a copy that just became free (returned, or released by a cancelled/expired hold): it is held for
 * the head of the book's reservation queue, or goes back on the shelf. Callers must hold the book's queue lock.
 */
@Component
public class QueueHandoff {

    private final ReservationRepository reservations;
    private final CopyRepository copies;
    private final OutboxRepository outbox;
    private final BookCache cache;
    private final ReservationPolicy policy;

    public QueueHandoff(ReservationRepository reservations, CopyRepository copies, OutboxRepository outbox,
                        BookCache cache, ReservationPolicy policy) {
        this.reservations = reservations;
        this.copies = copies;
        this.outbox = outbox;
        this.cache = cache;
        this.policy = policy;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void releaseCopy(UUID bookId, UUID copyId, Instant now) {
        Optional<Reservation> next = reservations.lockNextWaiting(bookId);
        if (next.isPresent()) {
            Reservation reservation = next.get();
            Instant readyUntil = policy.readyUntil(now);
            reservations.markReady(reservation.id(), copyId, readyUntil);
            copies.updateStatus(copyId, CopyStatus.RESERVED);
            outbox.append(new OutboxEvent("reservation", reservation.id(), "reservation.ready", Map.of(
                    "reservationId", reservation.id().toString(),
                    "memberId", reservation.memberId().toString(),
                    "bookId", bookId.toString(),
                    "copyId", copyId.toString(),
                    "readyUntil", readyUntil.toString())));
        } else {
            copies.updateStatus(copyId, CopyStatus.AVAILABLE);
        }
        cache.evict(bookId);
    }
}
