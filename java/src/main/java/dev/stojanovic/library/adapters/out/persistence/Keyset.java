package dev.stojanovic.library.adapters.out.persistence;

import dev.stojanovic.library.application.page.Cursor;

import java.time.Instant;
import java.util.UUID;

import static dev.stojanovic.library.adapters.out.persistence.Sql.ts;

/**
 * Keyset helpers for the common "(created_at, id) ascending" order. The cursor keeps the full microsecond timestamp
 * from PostgreSQL: truncating it to the API's millisecond format would make rows repeat or vanish across pages.
 */
final class Keyset {

    private Keyset() {
    }

    static void afterCreatedAt(Where where, String alias, Cursor after) {
        if (after == null) {
            return;
        }
        where.and("(" + alias + "created_at, " + alias + "id) > (:cursorCreatedAt, :cursorId)")
                .param("cursorCreatedAt", ts(after.instant("c")))
                .param("cursorId", after.uuid("id"));
    }

    static Cursor createdAtCursor(Instant createdAt, UUID id) {
        return Cursor.of("c", createdAt.toString(), "id", id.toString());
    }
}
