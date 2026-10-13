package dev.stojanovic.library.application.service;

import dev.stojanovic.library.application.model.OutboxEvent;
import dev.stojanovic.library.application.model.ReservationQuery;
import dev.stojanovic.library.application.model.ReservationView;
import dev.stojanovic.library.application.page.Page;
import dev.stojanovic.library.application.page.PageRequest;
import dev.stojanovic.library.application.port.out.BookRepository;
import dev.stojanovic.library.application.port.out.CopyRepository;
import dev.stojanovic.library.application.port.out.MemberRepository;
import dev.stojanovic.library.application.port.out.OutboxRepository;
import dev.stojanovic.library.application.port.out.ReservationRepository;
import dev.stojanovic.library.domain.error.ErrorKind;
import dev.stojanovic.library.domain.error.LibraryException;
import dev.stojanovic.library.domain.model.Actor;
import dev.stojanovic.library.domain.model.Member;
import dev.stojanovic.library.domain.model.Reservation;
import dev.stojanovic.library.domain.model.ReservationStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@Service
public class ReservationService {

    private final MemberRepository members;
    private final BookRepository books;
    private final CopyRepository copies;
    private final ReservationRepository reservations;
    private final OutboxRepository outbox;
    private final QueueHandoff handoff;
    private final Clock clock;

    public ReservationService(MemberRepository members, BookRepository books, CopyRepository copies,
                              ReservationRepository reservations, OutboxRepository outbox, QueueHandoff handoff,
                              Clock clock) {
        this.members = members;
        this.books = books;
        this.copies = copies;
        this.reservations = reservations;
        this.outbox = outbox;
        this.handoff = handoff;
        this.clock = clock;
    }

    @Transactional
    public ReservationView reserve(Actor actor, UUID bookId) {
        Member member = members.findById(actor.memberId()).orElseThrow(() -> LibraryException.notFound("Member"));
        if (member.isSuspended()) {
            throw new LibraryException(ErrorKind.MEMBER_SUSPENDED, "Suspended members cannot reserve books");
        }
        // The queue lock makes "no copy is available" and "join the queue" one atomic step with respect to returns.
        if (!books.lockForQueueChange(bookId)) {
            throw LibraryException.notFound("Book");
        }
        if (reservations.hasOpen(member.id(), bookId)) {
            throw new LibraryException(ErrorKind.ALREADY_RESERVED, "You already have an open reservation for this book");
        }
        if (copies.anyAvailable(bookId)) {
            throw new LibraryException(ErrorKind.COPY_AVAILABLE,
                    "A copy of this book is available; borrow it with POST /api/v2/loans");
        }
        UUID id = reservations.insert(bookId, member.id());
        return reservations.findView(id).orElseThrow();
    }

    /** Lock order book, then reservation; the state is re-checked under the reservation lock. */
    @Transactional
    public void cancel(Actor actor, UUID reservationId) {
        UUID bookId = reservations.findBookId(reservationId)
                .orElseThrow(() -> LibraryException.notFound("Reservation"));
        books.lockForQueueChange(bookId);
        Reservation reservation = reservations.lockById(reservationId)
                .filter(r -> actor.mayAccess(r.memberId()))
                .orElseThrow(() -> LibraryException.notFound("Reservation"));
        if (!reservation.status().isOpen()) {
            throw new LibraryException(ErrorKind.RESERVATION_NOT_CANCELLABLE,
                    "Only WAITING or READY reservations can be cancelled; this one is " + reservation.status());
        }
        reservations.close(reservation.id(), ReservationStatus.CANCELLED);
        if (reservation.status() == ReservationStatus.READY) {
            handoff.releaseCopy(reservation.bookId(), reservation.heldCopyId(), clock.instant());
        }
    }

    @Transactional(readOnly = true)
    public Page<ReservationView> list(Actor actor, UUID memberFilter, UUID bookFilter, PageRequest page) {
        UUID memberId = actor.isLibrarian() ? memberFilter : actor.memberId();
        return reservations.list(new ReservationQuery(memberId, bookFilter), page);
    }

    /**
     * Ends holds that were not collected in time and passes each held copy on. Safe on many instances: candidates
     * are read without locks (ordered by book), then each is re-checked after taking the book and reservation locks,
     * so a hold collected or expired by someone else in the meantime is skipped.
     */
    @Transactional
    public int expireHolds(int batchSize) {
        Instant now = clock.instant();
        int expired = 0;
        for (Reservation candidate : reservations.findExpired(now, batchSize)) {
            books.lockForQueueChange(candidate.bookId());
            Reservation reservation = reservations.lockById(candidate.id()).orElse(null);
            if (reservation == null || reservation.status() != ReservationStatus.READY
                    || !reservation.readyUntil().isBefore(now)) {
                continue;
            }
            expired++;
            reservations.close(reservation.id(), ReservationStatus.EXPIRED);
            outbox.append(new OutboxEvent("reservation", reservation.id(), "reservation.expired", Map.of(
                    "reservationId", reservation.id().toString(),
                    "memberId", reservation.memberId().toString(),
                    "bookId", reservation.bookId().toString())));
            handoff.releaseCopy(reservation.bookId(), reservation.heldCopyId(), now);
        }
        return expired;
    }
}
