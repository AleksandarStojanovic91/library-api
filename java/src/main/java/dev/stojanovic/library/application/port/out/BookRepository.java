package dev.stojanovic.library.application.port.out;

import dev.stojanovic.library.application.model.BookQuery;
import dev.stojanovic.library.application.model.BookView;
import dev.stojanovic.library.application.model.NewBook;
import dev.stojanovic.library.application.page.Page;
import dev.stojanovic.library.application.page.PageRequest;
import dev.stojanovic.library.domain.model.Book;

import java.util.Optional;
import java.util.UUID;

public interface BookRepository {

    Optional<BookView> findView(UUID id);

    Page<BookView> search(BookQuery query, PageRequest page);

    boolean exists(UUID id);

    /** Inserts the book and its author links; a duplicate ISBN is a {@code DUPLICATE} failure. */
    UUID insert(NewBook book);

    /** Loads the book and row-locks it until the transaction ends (PATCH). */
    Optional<Book> lockForUpdate(UUID id);

    /** Row-locks the book exclusively before deleting it; false if it does not exist. */
    boolean lockForDelete(UUID id);

    /**
     * Row-locks the book to serialise queue hand-offs (return, cancel, expiry) with new reservations, so a copy can
     * never become AVAILABLE while someone is joining the queue. Returns false if the book does not exist.
     */
    boolean lockForQueueChange(UUID id);

    /** Persists title/description/year/tags/authors and bumps the version; returns the new version. */
    int update(Book book);

    /** True if any copy is ON_LOAN or RESERVED. */
    boolean hasCopiesInUse(UUID id);

    /** True if the book was ever lent out; loan history is kept, so such a book cannot be deleted. */
    boolean hasLoanHistory(UUID id);

    void delete(UUID id);
}
