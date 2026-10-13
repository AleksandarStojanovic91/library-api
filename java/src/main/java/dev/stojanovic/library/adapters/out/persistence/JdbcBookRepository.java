package dev.stojanovic.library.adapters.out.persistence;

import dev.stojanovic.library.application.model.AuthorRef;
import dev.stojanovic.library.application.model.BookQuery;
import dev.stojanovic.library.application.model.BookSort;
import dev.stojanovic.library.application.model.BookView;
import dev.stojanovic.library.application.model.NewBook;
import dev.stojanovic.library.application.page.Cursor;
import dev.stojanovic.library.application.page.Page;
import dev.stojanovic.library.application.page.PageRequest;
import dev.stojanovic.library.application.port.out.BookRepository;
import dev.stojanovic.library.domain.error.ErrorKind;
import dev.stojanovic.library.domain.error.LibraryException;
import dev.stojanovic.library.domain.model.Book;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.json.JsonMapper;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static dev.stojanovic.library.adapters.out.persistence.Sql.instant;
import static dev.stojanovic.library.adapters.out.persistence.Sql.nullableInt;
import static dev.stojanovic.library.adapters.out.persistence.Sql.textArray;
import static dev.stojanovic.library.adapters.out.persistence.Sql.uuid;

@Repository
class JdbcBookRepository implements BookRepository {

    /** Book columns plus copy counts; {@code sort_title} is PostgreSQL's lower(), reused verbatim in cursors. */
    private static final String VIEW_COLUMNS = """
            b.id, b.isbn, b.title, b.description, b.published_year, b.tags, b.version, b.created_at, b.updated_at,
            lower(b.title) AS sort_title,
            (SELECT count(*) FROM copies c WHERE c.book_id = b.id) AS total_copies,
            (SELECT count(*) FROM copies c WHERE c.book_id = b.id AND c.status = 'AVAILABLE') AS available_copies""";

    /** Tags travel as one JSON array parameter: portable, and safe for tags containing commas or quotes. */
    private static final String TAGS_FROM_JSON = "ARRAY(SELECT jsonb_array_elements_text(CAST(:tags AS jsonb)))";

    private enum SearchMode {
        FULL_TEXT("fts", "ts_rank(b.search, websearch_to_tsquery('simple', :q))",
                "b.search @@ websearch_to_tsquery('simple', :q)"),
        TRIGRAM("trgm", "similarity(b.title, :q)", "b.title % :q");

        final String code;
        final String rank;
        final String match;

        SearchMode(String code, String rank, String match) {
            this.code = code;
            this.rank = rank;
            this.match = match;
        }

        static SearchMode fromCode(String code) {
            for (SearchMode mode : values()) {
                if (mode.code.equals(code)) {
                    return mode;
                }
            }
            throw Cursor.invalid();
        }
    }

    /** A row before authors are attached, with the keys a cursor needs. */
    private record Row(UUID id, String isbn, String title, String description, Integer publishedYear,
                       List<String> tags, int version, java.time.Instant createdAt, java.time.Instant updatedAt,
                       String sortTitle, int totalCopies, int availableCopies, Float rank) {
    }

    private final JdbcClient jdbc;
    private final JsonMapper json;

    JdbcBookRepository(JdbcClient jdbc, JsonMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Override
    public Optional<BookView> findView(UUID id) {
        return jdbc.sql("SELECT " + VIEW_COLUMNS + " FROM books b WHERE b.id = :id")
                .param("id", id)
                .query(rowMapper(false))
                .optional()
                .map(row -> withAuthors(List.of(row)).getFirst());
    }

    @Override
    public Page<BookView> search(BookQuery query, PageRequest page) {
        if (!query.hasText()) {
            return sortedPage(query, page);
        }
        if (page.after() != null) {
            // Later pages stay in the mode the first page chose, or a full-text query would "fall back" mid-way.
            return rankedPage(SearchMode.fromCode(page.after().requiredString("m")), query, page);
        }
        Page<BookView> fullText = rankedPage(SearchMode.FULL_TEXT, query, page);
        if (!fullText.items().isEmpty() || query.text().strip().length() < 3) {
            return fullText;
        }
        return rankedPage(SearchMode.TRIGRAM, query, page);
    }

    private Page<BookView> sortedPage(BookQuery query, PageRequest page) {
        Where where = filters(query);
        Cursor after = page.after();
        String orderBy;
        if (query.sort() == BookSort.PUBLISHED_YEAR_DESC) {
            // Descending key, descending tie-breaker: one row comparison; books without a year sort as -1 (last)
            orderBy = "coalesce(b.published_year, -1) DESC, b.id DESC";
            if (after != null) {
                requireSort(after, "year");
                where.and("(coalesce(b.published_year, -1), b.id) < (:cursorYear, :cursorId)")
                        .param("cursorYear", after.nullableInt("y"))
                        .param("cursorId", after.uuid("id"));
            }
        } else {
            orderBy = "lower(b.title), b.id";
            if (after != null) {
                requireSort(after, "title");
                where.and("(lower(b.title), b.id) > (:cursorTitle, :cursorId)")
                        .param("cursorTitle", after.requiredString("t"))
                        .param("cursorId", after.uuid("id"));
            }
        }
        List<Row> rows = jdbc.sql("SELECT " + VIEW_COLUMNS + " FROM books b" + where.sql()
                        + " ORDER BY " + orderBy + " LIMIT :limit")
                .params(where.params())
                .param("limit", page.fetchSize())
                .query(rowMapper(false))
                .list();
        Page<Row> rowPage = Page.fromOverfetch(rows, page, row -> query.sort() == BookSort.PUBLISHED_YEAR_DESC
                ? Cursor.of("s", "year", "y", Integer.toString(row.publishedYear() == null ? -1 : row.publishedYear()),
                "id", row.id().toString())
                : Cursor.of("s", "title", "t", row.sortTitle(), "id", row.id().toString()));
        return new Page<>(withAuthors(rowPage.items()), rowPage.next());
    }

    /** Ordered by relevance, ties by id (both descending, SPEC decision 16); the cursor carries (rank, id). */
    private Page<BookView> rankedPage(SearchMode mode, BookQuery query, PageRequest page) {
        Where inner = filters(query).and(mode.match).param("q", query.text().strip());
        Where outer = new Where();
        Cursor after = page.after();
        if (after != null) {
            outer.and("(s.rank, s.id) < (:cursorRank, :cursorId)")
                    .param("cursorRank", after.floatValue("r"))
                    .param("cursorId", after.uuid("id"));
        }
        String sql = "SELECT * FROM (SELECT " + VIEW_COLUMNS + ", " + mode.rank + " AS rank FROM books b" + inner.sql()
                + ") s" + outer.sql() + " ORDER BY s.rank DESC, s.id DESC LIMIT :limit";
        List<Row> rows = jdbc.sql(sql)
                .params(inner.params())
                .params(outer.params())
                .param("limit", page.fetchSize())
                .query(rowMapper(true))
                .list();
        Page<Row> rowPage = Page.fromOverfetch(rows, page, row -> Cursor.of("m", mode.code,
                "r", Float.toString(row.rank()), "id", row.id().toString()));
        return new Page<>(withAuthors(rowPage.items()), rowPage.next());
    }

    private static void requireSort(Cursor cursor, String sort) {
        if (!sort.equals(cursor.requiredString("s"))) {
            throw Cursor.invalid();
        }
    }

    private static Where filters(BookQuery query) {
        Where where = new Where();
        if (query.authorId() != null) {
            where.and("EXISTS (SELECT 1 FROM book_authors ba WHERE ba.book_id = b.id AND ba.author_id = :authorId)")
                    .param("authorId", query.authorId());
        }
        if (query.tag() != null) {
            // @> (not = ANY) so the GIN index on tags can be used
            where.and("b.tags @> ARRAY[CAST(:tag AS text)]").param("tag", query.tag());
        }
        if (query.available() != null) {
            // false = no AVAILABLE copy at all, including books without copies
            where.and((query.available() ? "" : "NOT ")
                    + "EXISTS (SELECT 1 FROM copies c WHERE c.book_id = b.id AND c.status = 'AVAILABLE')");
        }
        return where;
    }

    @Override
    public boolean exists(UUID id) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM books WHERE id = :id)").param("id", id)
                .query(Boolean.class).single();
    }

    @Override
    public UUID insert(NewBook book) {
        UUID id;
        try {
            id = jdbc.sql("INSERT INTO books (isbn, title, description, published_year, tags)"
                            + " VALUES (:isbn, :title, :description, :year, " + TAGS_FROM_JSON + ") RETURNING id")
                    .param("isbn", book.isbn())
                    .param("title", book.title())
                    .param("description", book.description())
                    .param("year", book.publishedYear())
                    .param("tags", json.writeValueAsString(book.tags()))
                    .query(UUID.class)
                    .single();
        } catch (DuplicateKeyException e) {
            throw new LibraryException(ErrorKind.DUPLICATE, "A book with ISBN " + book.isbn() + " already exists");
        }
        insertAuthors(id, book.authorIds());
        return id;
    }

    @Override
    public Optional<Book> lockForUpdate(UUID id) {
        // NO KEY UPDATE: blocks other writers of this row but not foreign-key checks (new loans, copies, reservations)
        return jdbc.sql("SELECT id, isbn, title, description, published_year, tags, version FROM books"
                        + " WHERE id = :id FOR NO KEY UPDATE")
                .param("id", id)
                .query((rs, n) -> new Book(uuid(rs, "id"), rs.getString("isbn"), rs.getString("title"),
                        rs.getString("description"), nullableInt(rs, "published_year"), textArray(rs, "tags"),
                        authorIdsOf(id), rs.getInt("version")))
                .optional();
    }

    @Override
    public boolean lockForDelete(UUID id) {
        return jdbc.sql("SELECT id FROM books WHERE id = :id FOR UPDATE").param("id", id)
                .query(UUID.class).optional().isPresent();
    }

    /**
     * SPEC asks for FOR UPDATE here. FOR NO KEY UPDATE serialises the same four operations (reserve, return, cancel,
     * expire) against each other, but unlike FOR UPDATE it does not conflict with the KEY SHARE lock that the
     * foreign-key check of a concurrent borrow's loan INSERT takes, so borrows still never wait for a return.
     */
    @Override
    public boolean lockForQueueChange(UUID id) {
        return jdbc.sql("SELECT id FROM books WHERE id = :id FOR NO KEY UPDATE").param("id", id)
                .query(UUID.class).optional().isPresent();
    }

    @Override
    public int update(Book book) {
        int version = jdbc.sql("UPDATE books SET title = :title, description = :description, published_year = :year,"
                        + " tags = " + TAGS_FROM_JSON + ", version = version + 1, updated_at = now()"
                        + " WHERE id = :id RETURNING version")
                .param("id", book.id())
                .param("title", book.title())
                .param("description", book.description())
                .param("year", book.publishedYear())
                .param("tags", json.writeValueAsString(book.tags()))
                .query(Integer.class)
                .single();
        if (!authorIdsOf(book.id()).equals(book.authorIds())) {
            jdbc.sql("DELETE FROM book_authors WHERE book_id = :id").param("id", book.id()).update();
            insertAuthors(book.id(), book.authorIds());
        }
        return version;
    }

    @Override
    public boolean hasCopiesInUse(UUID id) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM copies WHERE book_id = :id AND status IN ('ON_LOAN', 'RESERVED'))")
                .param("id", id).query(Boolean.class).single();
    }

    @Override
    public boolean hasLoanHistory(UUID id) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM loans WHERE book_id = :id)").param("id", id)
                .query(Boolean.class).single();
    }

    @Override
    public void delete(UUID id) {
        jdbc.sql("DELETE FROM books WHERE id = :id").param("id", id).update();
    }

    private List<UUID> authorIdsOf(UUID bookId) {
        return jdbc.sql("SELECT author_id FROM book_authors WHERE book_id = :id ORDER BY position")
                .param("id", bookId).query(UUID.class).list();
    }

    private void insertAuthors(UUID bookId, List<UUID> authorIds) {
        for (int i = 0; i < authorIds.size(); i++) {
            jdbc.sql("INSERT INTO book_authors (book_id, author_id, position) VALUES (:bookId, :authorId, :position)")
                    .param("bookId", bookId)
                    .param("authorId", authorIds.get(i))
                    .param("position", i + 1)
                    .update();
        }
    }

    /** One extra query for all authors of the page (never one per book). */
    private List<BookView> withAuthors(List<Row> rows) {
        Map<UUID, List<AuthorRef>> authors = authorsOf(rows.stream().map(Row::id).toList());
        return rows.stream().map(r -> new BookView(r.id(), r.isbn(), r.title(), r.description(), r.publishedYear(),
                authors.getOrDefault(r.id(), List.of()), r.tags(), r.totalCopies(), r.availableCopies(), r.version(),
                r.createdAt(), r.updatedAt())).toList();
    }

    private Map<UUID, List<AuthorRef>> authorsOf(Collection<UUID> bookIds) {
        Map<UUID, List<AuthorRef>> result = new LinkedHashMap<>();
        if (bookIds.isEmpty()) {
            return result;
        }
        jdbc.sql("SELECT ba.book_id, a.id, a.name FROM book_authors ba JOIN authors a ON a.id = ba.author_id"
                        + " WHERE ba.book_id IN (:ids) ORDER BY ba.book_id, ba.position")
                .param("ids", bookIds)
                .query((ResultSet rs) -> {
                    result.computeIfAbsent(uuid(rs, "book_id"), k -> new ArrayList<>())
                            .add(new AuthorRef(uuid(rs, "id"), rs.getString("name")));
                });
        return result;
    }

    private static RowMapper<Row> rowMapper(boolean ranked) {
        return (rs, n) -> new Row(uuid(rs, "id"), rs.getString("isbn"), rs.getString("title"),
                rs.getString("description"), nullableInt(rs, "published_year"), textArray(rs, "tags"),
                rs.getInt("version"), instant(rs, "created_at"), instant(rs, "updated_at"),
                rs.getString("sort_title"), rs.getInt("total_copies"), rs.getInt("available_copies"),
                ranked ? rankOf(rs) : null);
    }

    private static Float rankOf(ResultSet rs) throws SQLException {
        return rs.getFloat("rank");
    }
}
