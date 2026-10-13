package dev.stojanovic.library.domain.policy;

import dev.stojanovic.library.domain.model.Loan;
import dev.stojanovic.library.domain.model.Money;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/** Loan length, borrowing limit and the money side of being late. */
public record LoanPolicy(Duration loanPeriod, FeeCalculator fees) {

    public LoanPolicy {
        if (loanPeriod.isNegative() || loanPeriod.isZero()) {
            throw new IllegalArgumentException("loanPeriod must be positive");
        }
    }

    public Instant dueAt(Instant borrowedAt) {
        return borrowedAt.plus(loanPeriod);
    }

    public boolean mayBorrow(int openLoans, int maxActiveLoans) {
        return openLoans < maxActiveLoans;
    }

    /**
     * When the copy counts as returned. Clamped to the borrow time because {@code CLOCK_OFFSET_SECONDS} can move
     * "now" backwards between restarts, and the schema rightly refuses {@code returned_at < borrowed_at}.
     */
    public Instant returnTime(Loan loan, Instant now) {
        return now.isBefore(loan.borrowedAt()) ? loan.borrowedAt() : now;
    }

    /** Fee to store when the loan is returned at {@code returnedAt}; empty when it was not late. */
    public Optional<Integer> feeOnReturn(Loan loan, Instant returnedAt) {
        long cents = fees.feeCents(loan.dueAt(), returnedAt);
        return cents == 0 ? Optional.empty() : Optional.of(Math.toIntExact(cents));
    }

    /** Whole days late (rounded down): at return time for returned loans, otherwise now. */
    public int overdueDays(Loan loan, Instant now) {
        Instant end = loan.isOpen() ? now : loan.returnedAt();
        long lateMillis = Duration.between(loan.dueAt(), end).toMillis();
        return lateMillis <= 0 ? 0 : Math.toIntExact(lateMillis / Duration.ofDays(1).toMillis());
    }

    /** The fee a client should see: the stored fee once returned, or what returning now would cost. */
    public Optional<Money> currentFee(Loan loan, Instant now) {
        if (!loan.isOpen()) {
            return Optional.ofNullable(loan.feeCents()).map(Money::eurCents);
        }
        long cents = fees.feeCents(loan.dueAt(), now);
        return cents == 0 ? Optional.empty() : Optional.of(Money.eurCents(cents));
    }
}
