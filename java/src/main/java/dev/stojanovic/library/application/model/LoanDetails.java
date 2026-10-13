package dev.stojanovic.library.application.model;

import dev.stojanovic.library.domain.model.Loan;

/** A stored loan joined with the book and copy facts the v2 representation embeds. */
public record LoanDetails(Loan loan, String bookTitle, String bookIsbn, String copyBarcode) {
}
