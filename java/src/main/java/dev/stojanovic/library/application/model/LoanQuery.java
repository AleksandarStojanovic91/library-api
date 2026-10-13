package dev.stojanovic.library.application.model;

import dev.stojanovic.library.domain.model.LoanStatus;

import java.time.Instant;
import java.util.UUID;

/** {@code now} is part of the query because ACTIVE vs OVERDUE is decided in SQL against the business clock. */
public record LoanQuery(UUID memberId, LoanStatus status, Instant now) {
}
