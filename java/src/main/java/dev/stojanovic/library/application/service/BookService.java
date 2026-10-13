package dev.stojanovic.library.application.service;

import dev.stojanovic.library.application.model.BookQuery;
import dev.stojanovic.library.application.model.BookView;
import dev.stojanovic.library.application.model.CachedBook;
import dev.stojanovic.library.application.model.CopyView;
import dev.stojanovic.library.application.model.NewBook;
import dev.stojanovic.library.application.page.Page;
import dev.stojanovic.library.application.page.PageRequest;
import dev.stojanovic.library.application.port.out.AuthorRepository;
import dev.stojanovic.library.application.port.out.BookCache;
import dev.stojanovic.library.application.port.out.BookRepository;
import dev.stojanovic.library.application.port.out.CopyRepository;
import dev.stojanovic.library.domain.error.ErrorKind;
import dev.stojanovic.library.domain.error.LibraryException;
import dev.stojanovic.library.domain.error.ValidationException;
import dev.stojanovic.library.domain.model.Book;
import dev.stojanovic.library.domain.model.BookPatch;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.IntPredicate;
import java.util.stream.Collectors;

@Service
public class BookService {

    private final BookRepository books;
    private final AuthorRepository authors;
    private final CopyRepository copies;
    private final BookCache cache;

    public BookService(BookRepository books, AuthorRepository authors, CopyRepository copies, BookCache cache) {
        this.books = books;
        this.authors = authors;
        this.copies = copies;
        this.cache = cache;
    }

    @Transactional(readOnly = true)
    public Page<BookView> search(BookQuery query, PageRequest page) {
        return books.search(query, page);
    }

    /** Cache-aside read; deliberately outside a transaction so a cache hit never borrows a DB connection. */
    public CachedBook get(UUID id) {
        Optional<BookView> cached = cache.get(id);
        if (cached.isPresent()) {
            return new CachedBook(cached.get(), true);
        }
        BookView book = books.findView(id).orElseThrow(() -> LibraryException.notFound("Book"));
        cache.put(book);
        return new CachedBook(book, false);
    }

    @Transactional
    public BookView create(NewBook book) {
        requireAuthorsExist(book.authorIds());
        UUID id = books.insert(book);
        return books.findView(id).orElseThrow();
    }

    /**
     * @param versionMatches the client's If-Match precondition, checked against the locked row so two clients
     *                       holding the same ETag cannot both win
     */
    @Transactional
    public BookView update(UUID id, IntPredicate versionMatches, BookPatch patch) {
        Book current = books.lockForUpdate(id).orElseThrow(() -> LibraryException.notFound("Book"));
        if (!versionMatches.test(current.version())) {
            throw new LibraryException(ErrorKind.PRECONDITION_FAILED,
                    "The book is at version " + current.version() + "; re-read it and retry with its ETag");
        }
        if (patch.authorIds().isPresent()) {
            requireAuthorsExist(patch.authorIds().applyTo(List.of()));
        }
        books.update(current.apply(patch));
        cache.evict(id);
        return books.findView(id).orElseThrow();
    }

    @Transactional
    public void delete(UUID id) {
        if (!books.lockForDelete(id)) {
            throw LibraryException.notFound("Book");
        }
        if (books.hasCopiesInUse(id)) {
            throw new LibraryException(ErrorKind.BOOK_HAS_ACTIVE_LOANS,
                    "The book has copies on loan or held for a reservation");
        }
        if (books.hasLoanHistory(id)) {
            throw new LibraryException(ErrorKind.BOOK_HAS_LOAN_HISTORY,
                    "The book has past loans; its history is kept, so it cannot be deleted");
        }
        books.delete(id);
        cache.evict(id);
    }

    @Transactional(readOnly = true)
    public List<CopyView> listCopies(UUID bookId) {
        requireBook(bookId);
        return copies.listByBook(bookId);
    }

    @Transactional
    public CopyView addCopy(UUID bookId, String barcode) {
        requireBook(bookId);
        CopyView copy = copies.insert(bookId, barcode);
        cache.evict(bookId);
        return copy;
    }

    private void requireBook(UUID bookId) {
        if (!books.exists(bookId)) {
            throw LibraryException.notFound("Book");
        }
    }

    private void requireAuthorsExist(List<UUID> authorIds) {
        Set<UUID> existing = authors.existing(authorIds);
        String missing = authorIds.stream()
                .filter(id -> !existing.contains(id))
                .map(UUID::toString)
                .collect(Collectors.joining(", "));
        if (!missing.isEmpty()) {
            throw new ValidationException("authorIds", "Unknown author id(s): " + missing);
        }
    }
}
