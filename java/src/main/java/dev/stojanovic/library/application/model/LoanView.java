package dev.stojanovic.library.application.model;

import dev.stojanovic.library.domain.model.Loan;
import dev.stojanovic.library.domain.model.LoanStatus;
import dev.stojanovic.library.domain.model.Money;

/**
 * A loan with everything derived "as of now": status, whole overdue days and the fee a client should see
 * ({@code currentFee}: stored fee once returned, otherwise the fee if returned now).
 */
public record LoanView(Loan loan, String bookTitle, String bookIsbn, String copyBarcode, LoanStatus status,
                       int overdueDays, Money currentFee) {
}
