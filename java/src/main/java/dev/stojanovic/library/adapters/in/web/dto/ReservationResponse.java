package dev.stojanovic.library.adapters.in.web.dto;

import dev.stojanovic.library.application.model.ReservationView;
import dev.stojanovic.library.domain.model.ReservationStatus;

import java.time.Instant;
import java.util.UUID;

public record ReservationResponse(UUID id, UUID bookId, UUID memberId, ReservationStatus status, Integer position,
                                  UUID heldCopyId, Instant readyUntil, Instant createdAt) {

    public static ReservationResponse from(ReservationView r) {
        return new ReservationResponse(r.id(), r.bookId(), r.memberId(), r.status(), r.position(), r.heldCopyId(),
                r.readyUntil(), r.createdAt());
    }
}
