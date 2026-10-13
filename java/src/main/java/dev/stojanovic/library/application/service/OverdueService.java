package dev.stojanovic.library.application.service;

import dev.stojanovic.library.application.model.OutboxEvent;
import dev.stojanovic.library.application.port.out.LoanRepository;
import dev.stojanovic.library.application.port.out.OutboxRepository;
import dev.stojanovic.library.domain.model.Loan;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.List;
import java.util.Map;

@Service
public class OverdueService {

    private final LoanRepository loans;
    private final OutboxRepository outbox;
    private final Clock clock;

    public OverdueService(LoanRepository loans, OutboxRepository outbox, Clock clock) {
        this.loans = loans;
        this.outbox = outbox;
        this.clock = clock;
    }

    /** Emits {@code loan.overdue} once per loan; {@code overdue_notified_at} makes the scan idempotent. */
    @Transactional
    public int notifyOverdueLoans(int batchSize) {
        List<Loan> overdue = loans.flagOverdue(clock.instant(), batchSize);
        for (Loan loan : overdue) {
            outbox.append(new OutboxEvent("loan", loan.id(), "loan.overdue", Map.of(
                    "loanId", loan.id().toString(),
                    "memberId", loan.memberId().toString(),
                    "bookId", loan.bookId().toString(),
                    "dueAt", loan.dueAt().toString())));
        }
        return overdue.size();
    }
}
