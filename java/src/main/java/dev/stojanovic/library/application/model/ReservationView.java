package dev.stojanovic.library.application.model;

import dev.stojanovic.library.domain.model.ReservationStatus;

import java.time.Instant;
import java.util.UUID;

/** {@code position} is 1-based and only set while WAITING. */
public record ReservationView(UUID id, UUID bookId, UUID memberId, ReservationStatus status, Integer position,
                              UUID heldCopyId, Instant readyUntil, Instant createdAt) {
}
