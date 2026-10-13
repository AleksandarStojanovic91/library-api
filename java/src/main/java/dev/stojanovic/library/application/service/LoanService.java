package dev.stojanovic.library.application.service;

import dev.stojanovic.library.application.model.LoanDetails;
import dev.stojanovic.library.application.model.LoanQuery;
import dev.stojanovic.library.application.model.LoanView;
import dev.stojanovic.library.application.model.OutboxEvent;
import dev.stojanovic.library.application.page.Page;
import dev.stojanovic.library.application.page.PageRequest;
import dev.stojanovic.library.application.port.out.BookCache;
import dev.stojanovic.library.application.port.out.BookRepository;
import dev.stojanovic.library.application.port.out.CopyRepository;
import dev.stojanovic.library.application.port.out.LibraryMetrics;
import dev.stojanovic.library.application.port.out.LoanRepository;
import dev.stojanovic.library.application.port.out.MemberRepository;
import dev.stojanovic.library.application.port.out.OutboxRepository;
import dev.stojanovic.library.application.port.out.ReservationRepository;
import dev.stojanovic.library.domain.error.ErrorKind;
import dev.stojanovic.library.domain.error.LibraryException;
import dev.stojanovic.library.domain.model.Actor;
import dev.stojanovic.library.domain.model.CopyStatus;
import dev.stojanovic.library.domain.model.Loan;
import dev.stojanovic.library.domain.model.LoanStatus;
import dev.stojanovic.library.domain.model.Member;
import dev.stojanovic.library.domain.model.Reservation;
import dev.stojanovic.library.domain.model.ReservationStatus;
import dev.stojanovic.library.domain.policy.LoanPolicy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
public class LoanService {

    static final String NO_COPY_DETAIL =
            "No copy of this book is available. You can reserve it with POST /api/v1/reservations.";

    private final MemberRepository members;
    private final BookRepository books;
    private final CopyRepository copies;
    private final LoanRepository loans;
    private final ReservationRepository reservations;
    private final OutboxRepository outbox;
    private final QueueHandoff handoff;
    private final BookCache cache;
    private final LibraryMetrics metrics;
    private final LoanPolicy policy;
    private final Clock clock;

    public LoanService(MemberRepository members, BookRepository books, CopyRepository copies, LoanRepository loans,
                       ReservationRepository reservations, OutboxRepository outbox, QueueHandoff handoff,
                       BookCache cache, LibraryMetrics metrics, LoanPolicy policy, Clock clock) {
        this.members = members;
        this.books = books;
        this.copies = copies;
        this.loans = loans;
        this.reservations = reservations;
        this.outbox = outbox;
        this.handoff = handoff;
        this.cache = cache;
        this.metrics = metrics;
        this.policy = policy;
        this.clock = clock;
    }

    /**
     * Borrows one copy of a book. Concurrency: the member row lock serialises one member's borrows (so the loan
     * limit holds), and {@code FOR UPDATE SKIP LOCKED} on copies lets different members borrow in parallel without
     * ever taking the same copy. The partial unique index on open loans per copy is the last line of defence.
     */
    @Transactional
    public LoanView borrow(Actor actor, UUID bookId, UUID requestedMemberId) {
        if (requestedMemberId != null && !actor.isLibrarian()) {
            throw new LibraryException(ErrorKind.FORBIDDEN, "Only librarians can borrow on behalf of a member");
        }
        UUID memberId = requestedMemberId != null ? requestedMemberId : actor.memberId();

        Member member = members.lockById(memberId).orElseThrow(() -> LibraryException.notFound("Member"));
        if (member.isSuspended()) {
            throw new LibraryException(ErrorKind.MEMBER_SUSPENDED, "Suspended members cannot borrow books");
        }
        if (!books.exists(bookId)) {
            throw LibraryException.notFound("Book");
        }
        int openLoans = loans.countOpenByMember(memberId);
        if (!policy.mayBorrow(openLoans, member.maxActiveLoans())) {
            throw new LibraryException(ErrorKind.LOAN_LIMIT_REACHED,
                    "The member already has " + openLoans + " active loans (maximum " + member.maxActiveLoans() + ")");
        }

        Instant now = clock.instant();
        UUID copyId = takeHeldCopy(memberId, bookId, now)
                .or(() -> copies.claimAvailable(bookId))
                .orElseThrow(() -> new LibraryException(ErrorKind.NO_COPY_AVAILABLE, NO_COPY_DETAIL));
        copies.updateStatus(copyId, CopyStatus.ON_LOAN);

        Loan loan = new Loan(UUID.randomUUID(), bookId, copyId, memberId, now, policy.dueAt(now), null, null);
        loans.insert(loan);
        outbox.append(new OutboxEvent("loan", loan.id(), "loan.created", Map.of(
                "loanId", loan.id().toString(),
                "memberId", memberId.toString(),
                "bookId", bookId.toString(),
                "copyId", copyId.toString(),
                "dueAt", loan.dueAt().toString())));
        cache.evict(bookId);
        metrics.loanBorrowed();
        return view(loans.findDetails(loan.id()).orElseThrow(), now);
    }

    /** A READY reservation of this member for this book hands over its held copy and is fulfilled. */
    private Optional<UUID> takeHeldCopy(UUID memberId, UUID bookId, Instant now) {
        return reservations.lockReadyFor(memberId, bookId, now).map(reservation -> {
            reservations.close(reservation.id(), ReservationStatus.FULFILLED);
            return reservation.heldCopyId();
        });
    }

    /**
     * Returns a loan (borrower or librarian). Lock order is book, then loan: the book lock serialises the hand-off
     * with new reservations, and the loan is re-read under its own lock so concurrent returns see each other.
     */
    @Transactional
    public LoanView giveBack(Actor actor, UUID loanId) {
        UUID bookId = loans.findBookId(loanId).orElseThrow(() -> LibraryException.notFound("Loan"));
        books.lockForQueueChange(bookId);
        Loan loan = loans.lockById(loanId)
                .filter(l -> actor.mayAccess(l.memberId()))
                .orElseThrow(() -> LibraryException.notFound("Loan"));
        if (!loan.isOpen()) {
            throw new LibraryException(ErrorKind.ALREADY_RETURNED, "The loan was returned at " + loan.returnedAt());
        }
        Instant now = clock.instant();
        Instant returnedAt = policy.returnTime(loan, now);
        Integer feeCents = policy.feeOnReturn(loan, returnedAt).orElse(null);
        loans.markReturned(loan.id(), returnedAt, feeCents);
        handoff.releaseCopy(loan.bookId(), loan.copyId(), now);

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("loanId", loan.id().toString());
        payload.put("memberId", loan.memberId().toString());
        payload.put("bookId", loan.bookId().toString());
        payload.put("copyId", loan.copyId().toString());
        payload.put("feeCents", feeCents == null ? 0 : feeCents);
        outbox.append(new OutboxEvent("loan", loan.id(), "loan.returned", payload));
        metrics.loanReturned();
        return view(loans.findDetails(loan.id()).orElseThrow(), now);
    }

    @Transactional(readOnly = true)
    public LoanView get(Actor actor, UUID loanId) {
        LoanDetails details = loans.findDetails(loanId)
                .filter(d -> actor.mayAccess(d.loan().memberId()))
                .orElseThrow(() -> LibraryException.notFound("Loan"));
        return view(details, clock.instant());
    }

    /** Members always get their own loans; librarians see all or filter by member. */
    @Transactional(readOnly = true)
    public Page<LoanView> list(Actor actor, UUID memberFilter, LoanStatus status, PageRequest page) {
        UUID memberId = actor.isLibrarian() ? memberFilter : actor.memberId();
        Instant now = clock.instant();
        return loans.list(new LoanQuery(memberId, status, now), page).map(d -> view(d, now));
    }

    private LoanView view(LoanDetails details, Instant now) {
        Loan loan = details.loan();
        return new LoanView(loan, details.bookTitle(), details.bookIsbn(), details.copyBarcode(),
                loan.statusAt(now), policy.overdueDays(loan, now), policy.currentFee(loan, now).orElse(null));
    }
}
