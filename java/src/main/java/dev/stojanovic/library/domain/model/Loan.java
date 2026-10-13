package dev.stojanovic.library.domain.model;

import java.time.Instant;
import java.util.UUID;

/** A loan as stored. Status, overdue days and fees are derived from it with {@code LoanPolicy}. */
public record Loan(UUID id, UUID bookId, UUID copyId, UUID memberId, Instant borrowedAt, Instant dueAt,
                   Instant returnedAt, Integer feeCents) {

    public boolean isOpen() {
        return returnedAt == null;
    }

    public LoanStatus statusAt(Instant now) {
        if (!isOpen()) {
            return LoanStatus.RETURNED;
        }
        return now.isAfter(dueAt) ? LoanStatus.OVERDUE : LoanStatus.ACTIVE;
    }
}
