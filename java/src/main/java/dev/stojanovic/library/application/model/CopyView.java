package dev.stojanovic.library.application.model;

import dev.stojanovic.library.domain.model.CopyStatus;

import java.time.Instant;
import java.util.UUID;

public record CopyView(UUID id, UUID bookId, String barcode, CopyStatus status, Instant createdAt) {
}
