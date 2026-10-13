package dev.stojanovic.library.adapters.in.web;

import dev.stojanovic.library.adapters.in.web.dto.BookCreateRequest;
import dev.stojanovic.library.adapters.in.web.dto.BookResponse;
import dev.stojanovic.library.adapters.in.web.dto.CopyCreateRequest;
import dev.stojanovic.library.adapters.in.web.dto.CopyResponse;
import dev.stojanovic.library.adapters.in.web.dto.PageResponse;
import dev.stojanovic.library.adapters.in.web.support.ETags;
import dev.stojanovic.library.adapters.in.web.support.Paging;
import dev.stojanovic.library.adapters.in.web.validation.BookPatchParser;
import dev.stojanovic.library.application.model.BookQuery;
import dev.stojanovic.library.application.model.BookSort;
import dev.stojanovic.library.application.model.BookView;
import dev.stojanovic.library.application.model.CachedBook;
import dev.stojanovic.library.application.model.CopyView;
import dev.stojanovic.library.application.model.NewBook;
import dev.stojanovic.library.application.page.PageRequest;
import dev.stojanovic.library.application.service.BookService;
import dev.stojanovic.library.domain.error.ErrorKind;
import dev.stojanovic.library.domain.error.LibraryException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.net.URI;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/books")
class BookController {

    static final String MERGE_PATCH_JSON = "application/merge-patch+json";

    private final BookService books;
    private final Paging paging;

    BookController(BookService books, Paging paging) {
        this.books = books;
        this.paging = paging;
    }

    @GetMapping
    PageResponse<BookResponse> list(
            @RequestParam(required = false) @Min(1) @Max(100) Integer limit,
            @RequestParam(required = false) @Size(max = 500) String cursor,
            @RequestParam(required = false) @Size(max = 200) String q,
            @RequestParam(required = false) UUID authorId,
            @RequestParam(required = false) @Size(max = 50) String tag,
            @RequestParam(required = false) Boolean available,
            @RequestParam(required = false) @Pattern(regexp = "title|-publishedYear") String sort) {
        PageRequest page = paging.request(limit, cursor);
        BookSort order = "-publishedYear".equals(sort) ? BookSort.PUBLISHED_YEAR_DESC : BookSort.TITLE;
        return paging.response(books.search(new BookQuery(q, authorId, tag, available, order), page), page,
                BookResponse::from);
    }

    @PostMapping
    ResponseEntity<BookResponse> create(@Valid @RequestBody BookCreateRequest request) {
        BookView book = books.create(new NewBook(request.isbn(), request.title(), request.description(),
                request.publishedYear(), request.authorUuids(), Objects.requireNonNullElse(request.tags(), List.of())));
        return ResponseEntity.created(URI.create("/api/v1/books/" + book.id()))
                .eTag(ETags.of(book.version()))
                .body(BookResponse.from(book));
    }

    @GetMapping("/{bookId}")
    ResponseEntity<BookResponse> get(@PathVariable UUID bookId,
                                     @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch) {
        CachedBook result = books.get(bookId);
        BookView book = result.book();
        boolean notModified = ETags.noneMatchHits(ifNoneMatch, book.version());
        ResponseEntity.BodyBuilder response = (notModified ? ResponseEntity.status(HttpStatus.NOT_MODIFIED)
                : ResponseEntity.ok())
                .eTag(ETags.of(book.version()))
                .header("X-Cache", result.cacheHit() ? "HIT" : "MISS");
        return notModified ? response.build() : response.body(BookResponse.from(book));
    }

    @PatchMapping(path = "/{bookId}", consumes = {MERGE_PATCH_JSON, "application/json"})
    ResponseEntity<BookResponse> update(@PathVariable UUID bookId,
                                        @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
                                        @RequestBody JsonNode body) {
        if (ifMatch == null || ifMatch.isBlank()) {
            throw new LibraryException(ErrorKind.PRECONDITION_REQUIRED,
                    "Send If-Match with the ETag from your last read of the book");
        }
        BookView book = books.update(bookId, ETags.ifMatch(ifMatch), BookPatchParser.parse(body));
        return ResponseEntity.ok().eTag(ETags.of(book.version())).body(BookResponse.from(book));
    }

    @DeleteMapping("/{bookId}")
    ResponseEntity<Void> delete(@PathVariable UUID bookId) {
        books.delete(bookId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{bookId}/copies")
    CopyResponse.CopyList copies(@PathVariable UUID bookId) {
        return new CopyResponse.CopyList(books.listCopies(bookId).stream().map(CopyResponse::from).toList());
    }

    @PostMapping("/{bookId}/copies")
    ResponseEntity<CopyResponse> addCopy(@PathVariable UUID bookId, @Valid @RequestBody CopyCreateRequest request) {
        CopyView copy = books.addCopy(bookId, request.barcode());
        return ResponseEntity.created(URI.create("/api/v1/books/" + bookId + "/copies/" + copy.id()))
                .body(CopyResponse.from(copy));
    }
}
