package dev.stojanovic.library.adapters.in.web.dto;

import dev.stojanovic.library.application.model.LoanView;
import dev.stojanovic.library.domain.model.LoanStatus;

import java.time.Instant;
import java.util.UUID;

/** v2 shape: embeds book and copy, adds overdue days and the fee as Money. */
public record LoanV2Response(UUID id, BookSummary book, CopySummary copy, UUID memberId, LoanStatus status,
                             Instant borrowedAt, Instant dueAt, Instant returnedAt, int overdueDays, MoneyResponse fee) {

    public record BookSummary(UUID id, String title, String isbn) {
    }

    public record CopySummary(UUID id, String barcode) {
    }

    public record MoneyResponse(String amount, String currency) {
    }

    public static LoanV2Response from(LoanView v) {
        var loan = v.loan();
        MoneyResponse fee = v.currentFee() == null ? null
                : new MoneyResponse(v.currentFee().amount(), v.currentFee().currency());
        return new LoanV2Response(loan.id(), new BookSummary(loan.bookId(), v.bookTitle(), v.bookIsbn()),
                new CopySummary(loan.copyId(), v.copyBarcode()), loan.memberId(), v.status(), loan.borrowedAt(),
                loan.dueAt(), loan.returnedAt(), v.overdueDays(), fee);
    }
}
