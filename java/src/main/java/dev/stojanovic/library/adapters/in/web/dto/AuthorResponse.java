package dev.stojanovic.library.adapters.in.web.dto;

import dev.stojanovic.library.application.model.AuthorView;

import java.time.Instant;
import java.util.UUID;

public record AuthorResponse(UUID id, String name, String bio, Instant createdAt) {

    public static AuthorResponse from(AuthorView a) {
        return new AuthorResponse(a.id(), a.name(), a.bio(), a.createdAt());
    }
}
