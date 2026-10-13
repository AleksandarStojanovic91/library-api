package dev.stojanovic.library.application.model;

import java.time.Instant;
import java.util.UUID;

public record AuthorView(UUID id, String name, String bio, Instant createdAt) {
}
