package dev.stojanovic.library.adapters.out.persistence;

import dev.stojanovic.library.application.model.MemberCredentials;
import dev.stojanovic.library.application.model.MemberView;
import dev.stojanovic.library.application.page.Page;
import dev.stojanovic.library.application.page.PageRequest;
import dev.stojanovic.library.application.port.out.MemberRepository;
import dev.stojanovic.library.domain.error.ErrorKind;
import dev.stojanovic.library.domain.error.LibraryException;
import dev.stojanovic.library.domain.model.Member;
import dev.stojanovic.library.domain.model.MemberStatus;
import dev.stojanovic.library.domain.model.Role;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

import static dev.stojanovic.library.adapters.out.persistence.Sql.instant;
import static dev.stojanovic.library.adapters.out.persistence.Sql.uuid;

@Repository
class JdbcMemberRepository implements MemberRepository {

    private static final String COLUMNS = "m.id, m.email, m.name, m.role, m.status, m.max_active_loans, m.created_at";
    private static final String VIEW_COLUMNS = COLUMNS
            + ", (SELECT count(*) FROM loans l WHERE l.member_id = m.id AND l.returned_at IS NULL) AS active_loans";

    private static final RowMapper<Member> MEMBER = (rs, n) -> new Member(uuid(rs, "id"), rs.getString("email"),
            rs.getString("name"), Role.valueOf(rs.getString("role")), MemberStatus.valueOf(rs.getString("status")),
            rs.getInt("max_active_loans"), instant(rs, "created_at"));

    private static final RowMapper<MemberView> VIEW = (rs, n) -> new MemberView(uuid(rs, "id"), rs.getString("email"),
            rs.getString("name"), Role.valueOf(rs.getString("role")), MemberStatus.valueOf(rs.getString("status")),
            rs.getInt("max_active_loans"), rs.getInt("active_loans"), instant(rs, "created_at"));

    private final JdbcClient jdbc;

    JdbcMemberRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Optional<Member> findById(UUID id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM members m WHERE m.id = :id").param("id", id)
                .query(MEMBER).optional();
    }

    @Override
    public Optional<Member> lockById(UUID id) {
        // The weakest lock that still serialises borrows of one member: unlike FOR UPDATE it does not block
        // foreign-key checks of rows that reference the member (e.g. notifications written by the worker).
        return jdbc.sql("SELECT " + COLUMNS + " FROM members m WHERE m.id = :id FOR NO KEY UPDATE").param("id", id)
                .query(MEMBER).optional();
    }

    @Override
    public Optional<MemberCredentials> findCredentialsByEmail(String email) {
        return jdbc.sql("SELECT id, email, role, password_hash FROM members WHERE lower(email) = lower(:email)")
                .param("email", email)
                .query((rs, n) -> new MemberCredentials(uuid(rs, "id"), rs.getString("email"),
                        Role.valueOf(rs.getString("role")), rs.getString("password_hash")))
                .optional();
    }

    @Override
    public Optional<MemberView> findView(UUID id) {
        return jdbc.sql("SELECT " + VIEW_COLUMNS + " FROM members m WHERE m.id = :id").param("id", id)
                .query(VIEW).optional();
    }

    @Override
    public Page<MemberView> list(PageRequest page) {
        Where where = new Where();
        Keyset.afterCreatedAt(where, "m.", page.after());
        var rows = jdbc.sql("SELECT " + VIEW_COLUMNS + " FROM members m" + where.sql()
                        + " ORDER BY m.created_at, m.id LIMIT :limit")
                .params(where.params())
                .param("limit", page.fetchSize())
                .query(VIEW)
                .list();
        return Page.fromOverfetch(rows, page, m -> Keyset.createdAtCursor(m.createdAt(), m.id()));
    }

    @Override
    public boolean updateStatus(UUID id, MemberStatus status, Integer maxActiveLoans) {
        return jdbc.sql("UPDATE members SET status = :status,"
                        + " max_active_loans = coalesce(:max, max_active_loans) WHERE id = :id")
                .param("id", id)
                .param("status", status.name())
                .param("max", maxActiveLoans)
                .update() == 1;
    }

    @Override
    public UUID insert(String email, String name, String passwordHash, int maxActiveLoans) {
        try {
            return jdbc.sql("INSERT INTO members (email, name, password_hash, max_active_loans)"
                            + " VALUES (:email, :name, :hash, :max) RETURNING id")
                    .param("email", email)
                    .param("name", name)
                    .param("hash", passwordHash)
                    .param("max", maxActiveLoans)
                    .query(UUID.class)
                    .single();
        } catch (DuplicateKeyException e) {
            throw new LibraryException(ErrorKind.DUPLICATE, "A member with this email already exists");
        }
    }
}
