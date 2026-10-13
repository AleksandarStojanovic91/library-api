package dev.stojanovic.library.application.port.out;

import dev.stojanovic.library.application.model.BookView;

import java.util.Optional;
import java.util.UUID;

/** Best-effort cache: implementations must never fail the caller when the cache is unavailable. */
public interface BookCache {

    Optional<BookView> get(UUID bookId);

    void put(BookView book);

    /** Evicts the entry once the current transaction commits (immediately if there is none). */
    void evict(UUID bookId);
}
