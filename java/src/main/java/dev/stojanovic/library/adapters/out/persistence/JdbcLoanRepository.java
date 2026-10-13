package dev.stojanovic.library.adapters.out.persistence;

import dev.stojanovic.library.application.model.LoanDetails;
import dev.stojanovic.library.application.model.LoanQuery;
import dev.stojanovic.library.application.page.Cursor;
import dev.stojanovic.library.application.page.Page;
import dev.stojanovic.library.application.page.PageRequest;
import dev.stojanovic.library.application.port.out.LoanRepository;
import dev.stojanovic.library.domain.error.ErrorKind;
import dev.stojanovic.library.domain.error.LibraryException;
import dev.stojanovic.library.domain.model.Loan;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static dev.stojanovic.library.adapters.out.persistence.Sql.instant;
import static dev.stojanovic.library.adapters.out.persistence.Sql.nullableInt;
import static dev.stojanovic.library.adapters.out.persistence.Sql.ts;
import static dev.stojanovic.library.adapters.out.persistence.Sql.uuid;

@Repository
class JdbcLoanRepository implements LoanRepository {

    private static final String COLUMNS =
            "l.id, l.book_id, l.copy_id, l.member_id, l.borrowed_at, l.due_at, l.returned_at, l.fee_cents";
    private static final String DETAILS = "SELECT " + COLUMNS
            + ", b.title AS book_title, b.isbn AS book_isbn, c.barcode AS copy_barcode"
            + " FROM loans l JOIN books b ON b.id = l.book_id JOIN copies c ON c.id = l.copy_id";

    private static final RowMapper<Loan> LOAN = (rs, n) -> new Loan(uuid(rs, "id"), uuid(rs, "book_id"),
            uuid(rs, "copy_id"), uuid(rs, "member_id"), instant(rs, "borrowed_at"), instant(rs, "due_at"),
            instant(rs, "returned_at"), nullableInt(rs, "fee_cents"));

    private static final RowMapper<LoanDetails> LOAN_DETAILS = (rs, n) -> new LoanDetails(LOAN.mapRow(rs, n),
            rs.getString("book_title"), rs.getString("book_isbn"), rs.getString("copy_barcode"));

    private final JdbcClient jdbc;

    JdbcLoanRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public int countOpenByMember(UUID memberId) {
        return jdbc.sql("SELECT count(*) FROM loans WHERE member_id = :memberId AND returned_at IS NULL")
                .param("memberId", memberId).query(Integer.class).single();
    }

    @Override
    public void insert(Loan loan) {
        try {
            jdbc.sql("INSERT INTO loans (id, copy_id, book_id, member_id, borrowed_at, due_at)"
                            + " VALUES (:id, :copyId, :bookId, :memberId, :borrowedAt, :dueAt)")
                    .param("id", loan.id())
                    .param("copyId", loan.copyId())
                    .param("bookId", loan.bookId())
                    .param("memberId", loan.memberId())
                    .param("borrowedAt", ts(loan.borrowedAt()))
                    .param("dueAt", ts(loan.dueAt()))
                    .update();
        } catch (DuplicateKeyException e) {
            // ux_loans_open_copy: should be unreachable thanks to the copy row lock, but never lend a copy twice
            throw new LibraryException(ErrorKind.NO_COPY_AVAILABLE, "The copy was lent out concurrently, retry");
        }
    }

    @Override
    public Optional<UUID> findBookId(UUID loanId) {
        return jdbc.sql("SELECT book_id FROM loans WHERE id = :id").param("id", loanId).query(UUID.class).optional();
    }

    @Override
    public Optional<Loan> lockById(UUID id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM loans l WHERE l.id = :id FOR UPDATE").param("id", id)
                .query(LOAN).optional();
    }

    @Override
    public void markReturned(UUID id, Instant returnedAt, Integer feeCents) {
        jdbc.sql("UPDATE loans SET returned_at = :returnedAt, fee_cents = :fee WHERE id = :id")
                .param("id", id).param("returnedAt", ts(returnedAt)).param("fee", feeCents).update();
    }

    @Override
    public Optional<LoanDetails> findDetails(UUID id) {
        return jdbc.sql(DETAILS + " WHERE l.id = :id").param("id", id).query(LOAN_DETAILS).optional();
    }

    @Override
    public Page<LoanDetails> list(LoanQuery query, PageRequest page) {
        Where where = new Where();
        if (query.memberId() != null) {
            where.and("l.member_id = :memberId").param("memberId", query.memberId());
        }
        if (query.status() != null) {
            // Status is derived, so the filter is expressed against returned_at/due_at (and can use the indexes)
            switch (query.status()) {
                case RETURNED -> where.and("l.returned_at IS NOT NULL");
                case OVERDUE -> where.and("l.returned_at IS NULL AND l.due_at < :now");
                case ACTIVE -> where.and("l.returned_at IS NULL AND l.due_at >= :now");
            }
            where.param("now", ts(query.now()));
        }
        Cursor after = page.after();
        if (after != null) {
            where.and("(l.borrowed_at, l.id) < (:cursorBorrowedAt, :cursorId)")
                    .param("cursorBorrowedAt", ts(after.instant("b")))
                    .param("cursorId", after.uuid("id"));
        }
        var rows = jdbc.sql(DETAILS + where.sql() + " ORDER BY l.borrowed_at DESC, l.id DESC LIMIT :limit")
                .params(where.params())
                .param("limit", page.fetchSize())
                .query(LOAN_DETAILS)
                .list();
        return Page.fromOverfetch(rows, page, d -> Cursor.of(
                "b", d.loan().borrowedAt().toString(), "id", d.loan().id().toString()));
    }

    @Override
    public List<Loan> flagOverdue(Instant now, int batchSize) {
        return jdbc.sql("""
                        WITH due AS (
                            SELECT id FROM loans
                            WHERE returned_at IS NULL AND due_at < :now AND overdue_notified_at IS NULL
                            ORDER BY due_at
                            LIMIT :batch
                            FOR UPDATE SKIP LOCKED
                        )
                        UPDATE loans l SET overdue_notified_at = :now
                        FROM due WHERE l.id = due.id
                        RETURNING""" + " " + COLUMNS)
                .param("now", ts(now))
                .param("batch", batchSize)
                .query(LOAN)
                .list();
    }
}
