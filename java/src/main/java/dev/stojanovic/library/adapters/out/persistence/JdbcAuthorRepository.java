package dev.stojanovic.library.adapters.out.persistence;

import dev.stojanovic.library.application.model.AuthorView;
import dev.stojanovic.library.application.page.Page;
import dev.stojanovic.library.application.page.PageRequest;
import dev.stojanovic.library.application.port.out.AuthorRepository;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.HashSet;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static dev.stojanovic.library.adapters.out.persistence.Sql.instant;
import static dev.stojanovic.library.adapters.out.persistence.Sql.uuid;

@Repository
class JdbcAuthorRepository implements AuthorRepository {

    private static final String COLUMNS = "id, name, bio, created_at";
    private static final RowMapper<AuthorView> MAPPER = (rs, n) ->
            new AuthorView(uuid(rs, "id"), rs.getString("name"), rs.getString("bio"), instant(rs, "created_at"));

    private final JdbcClient jdbc;

    JdbcAuthorRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Page<AuthorView> list(PageRequest page) {
        Where where = new Where();
        Keyset.afterCreatedAt(where, "", page.after());
        var rows = jdbc.sql("SELECT " + COLUMNS + " FROM authors" + where.sql() + " ORDER BY created_at, id LIMIT :limit")
                .params(where.params())
                .param("limit", page.fetchSize())
                .query(MAPPER)
                .list();
        return Page.fromOverfetch(rows, page, a -> Keyset.createdAtCursor(a.createdAt(), a.id()));
    }

    @Override
    public Optional<AuthorView> findById(UUID id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM authors WHERE id = :id").param("id", id).query(MAPPER).optional();
    }

    @Override
    public AuthorView insert(String name, String bio) {
        return jdbc.sql("INSERT INTO authors (name, bio) VALUES (:name, :bio) RETURNING " + COLUMNS)
                .param("name", name)
                .param("bio", bio)
                .query(MAPPER)
                .single();
    }

    @Override
    public Set<UUID> existing(Collection<UUID> ids) {
        if (ids.isEmpty()) {
            return Set.of();
        }
        return new HashSet<>(jdbc.sql("SELECT id FROM authors WHERE id IN (:ids)").param("ids", ids)
                .query(UUID.class).list());
    }
}
