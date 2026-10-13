package dev.stojanovic.library.application.model;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Read model of a book as clients see it (also what the cache stores). */
public record BookView(UUID id, String isbn, String title, String description, Integer publishedYear,
                       List<AuthorRef> authors, List<String> tags, int totalCopies, int availableCopies,
                       int version, Instant createdAt, Instant updatedAt) {
}
