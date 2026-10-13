package dev.stojanovic.library.adapters.out.persistence;

import dev.stojanovic.library.application.model.CopyView;
import dev.stojanovic.library.application.port.out.CopyRepository;
import dev.stojanovic.library.domain.error.ErrorKind;
import dev.stojanovic.library.domain.error.LibraryException;
import dev.stojanovic.library.domain.model.CopyStatus;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static dev.stojanovic.library.adapters.out.persistence.Sql.instant;
import static dev.stojanovic.library.adapters.out.persistence.Sql.uuid;

@Repository
class JdbcCopyRepository implements CopyRepository {

    private static final String COLUMNS = "id, book_id, barcode, status, created_at";
    private static final RowMapper<CopyView> MAPPER = (rs, n) -> new CopyView(uuid(rs, "id"), uuid(rs, "book_id"),
            rs.getString("barcode"), CopyStatus.valueOf(rs.getString("status")), instant(rs, "created_at"));

    private final JdbcClient jdbc;

    JdbcCopyRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<CopyView> listByBook(UUID bookId) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM copies WHERE book_id = :bookId ORDER BY created_at, id")
                .param("bookId", bookId).query(MAPPER).list();
    }

    @Override
    public CopyView insert(UUID bookId, String barcode) {
        try {
            return jdbc.sql("INSERT INTO copies (book_id, barcode) VALUES (:bookId, :barcode) RETURNING " + COLUMNS)
                    .param("bookId", bookId).param("barcode", barcode).query(MAPPER).single();
        } catch (DuplicateKeyException e) {
            throw new LibraryException(ErrorKind.DUPLICATE, "A copy with barcode " + barcode + " already exists");
        }
    }

    @Override
    public Optional<UUID> claimAvailable(UUID bookId) {
        return jdbc.sql("""
                        SELECT id FROM copies
                        WHERE book_id = :bookId AND status = 'AVAILABLE'
                        ORDER BY created_at, id
                        LIMIT 1
                        FOR UPDATE SKIP LOCKED""")
                .param("bookId", bookId).query(UUID.class).optional();
    }

    @Override
    public boolean anyAvailable(UUID bookId) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM copies WHERE book_id = :bookId AND status = 'AVAILABLE')")
                .param("bookId", bookId).query(Boolean.class).single();
    }

    @Override
    public void updateStatus(UUID copyId, CopyStatus status) {
        jdbc.sql("UPDATE copies SET status = :status WHERE id = :id")
                .param("id", copyId).param("status", status.name()).update();
    }
}
