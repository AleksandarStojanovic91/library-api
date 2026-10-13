package dev.stojanovic.library.domain.model;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

/** The editable state of a book (its "write model"); copies and availability live elsewhere. */
public record Book(UUID id, String isbn, String title, String description, Integer publishedYear,
                   List<String> tags, List<UUID> authorIds, int version) {

    public Book {
        Objects.requireNonNull(isbn, "isbn");
        Objects.requireNonNull(title, "title");
        tags = List.copyOf(tags);
        authorIds = List.copyOf(authorIds);
        if (authorIds.isEmpty()) {
            throw new IllegalArgumentException("A book needs at least one author");
        }
    }

    /** Applies a merge patch; the ISBN is immutable and the version is bumped by the repository. */
    public Book apply(BookPatch patch) {
        return new Book(id, isbn,
                patch.title().applyTo(title),
                patch.description().applyTo(description),
                patch.publishedYear().applyTo(publishedYear),
                patch.tags().applyTo(tags),
                patch.authorIds().applyTo(authorIds),
                version);
    }

    public boolean hasVersion(int expected) {
        return version == expected;
    }
}
