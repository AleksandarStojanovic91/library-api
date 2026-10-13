package dev.stojanovic.library.adapters.in.web.dto;

import dev.stojanovic.library.application.model.BookView;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record BookResponse(UUID id, String isbn, String title, String description, Integer publishedYear,
                           List<AuthorRef> authors, List<String> tags, int totalCopies, int availableCopies,
                           int version, Instant createdAt, Instant updatedAt) {

    public record AuthorRef(UUID id, String name) {
    }

    public static BookResponse from(BookView b) {
        return new BookResponse(b.id(), b.isbn(), b.title(), b.description(), b.publishedYear(),
                b.authors().stream().map(a -> new AuthorRef(a.id(), a.name())).toList(), b.tags(), b.totalCopies(),
                b.availableCopies(), b.version(), b.createdAt(), b.updatedAt());
    }
}
