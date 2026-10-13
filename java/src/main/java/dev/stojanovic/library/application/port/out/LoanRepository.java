package dev.stojanovic.library.application.port.out;

import dev.stojanovic.library.application.model.LoanDetails;
import dev.stojanovic.library.application.model.LoanQuery;
import dev.stojanovic.library.application.page.Page;
import dev.stojanovic.library.application.page.PageRequest;
import dev.stojanovic.library.domain.model.Loan;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface LoanRepository {

    int countOpenByMember(UUID memberId);

    void insert(Loan loan);

    /** Unlocked read, used to find which book to lock first (lock order: book before loan). */
    Optional<UUID> findBookId(UUID loanId);

    Optional<Loan> lockById(UUID id);

    void markReturned(UUID id, Instant returnedAt, Integer feeCents);

    Optional<LoanDetails> findDetails(UUID id);

    Page<LoanDetails> list(LoanQuery query, PageRequest page);

    /**
     * Marks up to {@code batchSize} open loans that are past due and not yet notified, skipping rows other workers
     * hold, and returns them.
     */
    List<Loan> flagOverdue(Instant now, int batchSize);
}
