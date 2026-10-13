package dev.stojanovic.library.domain.model;

import java.time.Instant;
import java.util.UUID;

public record Reservation(UUID id, UUID bookId, UUID memberId, ReservationStatus status, UUID heldCopyId,
                          Instant readyUntil, Instant createdAt) {
}
