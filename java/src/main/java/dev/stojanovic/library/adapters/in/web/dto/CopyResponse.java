package dev.stojanovic.library.adapters.in.web.dto;

import dev.stojanovic.library.application.model.CopyView;
import dev.stojanovic.library.domain.model.CopyStatus;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record CopyResponse(UUID id, UUID bookId, String barcode, CopyStatus status, Instant createdAt) {

    public record CopyList(List<CopyResponse> data) {
    }

    public static CopyResponse from(CopyView c) {
        return new CopyResponse(c.id(), c.bookId(), c.barcode(), c.status(), c.createdAt());
    }
}
