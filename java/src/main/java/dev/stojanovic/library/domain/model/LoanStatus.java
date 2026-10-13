package dev.stojanovic.library.domain.model;

/** Derived, never stored: a loan is RETURNED, or OVERDUE when open past its due date, otherwise ACTIVE. */
public enum LoanStatus {
    ACTIVE,
    OVERDUE,
    RETURNED
}
