package dev.stojanovic.library.application.model;

import java.util.UUID;

public record ReservationQuery(UUID memberId, UUID bookId) {
}
