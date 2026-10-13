package dev.stojanovic.library.adapters.in.web.dto;

import dev.stojanovic.library.application.model.LoanView;
import dev.stojanovic.library.domain.model.LoanStatus;

import java.time.Instant;
import java.util.UUID;

/** Deprecated v1 shape: flat ids and the stored fee in cents (null until a late return). */
public record LoanV1Response(UUID id, UUID bookId, UUID copyId, UUID memberId, LoanStatus status, Instant borrowedAt,
                             Instant dueAt, Instant returnedAt, Integer feeCents) {

    public static LoanV1Response from(LoanView v) {
        var loan = v.loan();
        return new LoanV1Response(loan.id(), loan.bookId(), loan.copyId(), loan.memberId(), v.status(),
                loan.borrowedAt(), loan.dueAt(), loan.returnedAt(), loan.feeCents());
    }
}
