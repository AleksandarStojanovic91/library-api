package dev.stojanovic.library.adapters.out.persistence;

import dev.stojanovic.library.application.model.OutboxEvent;
import dev.stojanovic.library.application.model.OutboxMessage;
import dev.stojanovic.library.application.port.out.OutboxRepository;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.util.UUID;

import static dev.stojanovic.library.adapters.out.persistence.Sql.uuid;

@Repository
class JdbcOutboxRepository implements OutboxRepository {

    private final JdbcClient jdbc;
    private final JsonMapper json;

    JdbcOutboxRepository(JdbcClient jdbc, JsonMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Override
    public void append(OutboxEvent event) {
        jdbc.sql("INSERT INTO outbox (aggregate_type, aggregate_id, event_type, payload)"
                        + " VALUES (:type, :aggregateId, :eventType, CAST(:payload AS jsonb))")
                .param("type", event.aggregateType())
                .param("aggregateId", event.aggregateId())
                .param("eventType", event.eventType())
                .param("payload", json.writeValueAsString(event.payload()))
                .update();
    }

    @Override
    public List<OutboxMessage> lockUnpublished(int batchSize, int maxAttempts) {
        return jdbc.sql("""
                        SELECT id, event_type, aggregate_id, payload::text AS payload, attempts
                        FROM outbox
                        WHERE published_at IS NULL AND attempts < :maxAttempts
                        ORDER BY id
                        LIMIT :batch
                        FOR UPDATE SKIP LOCKED""")
                .param("maxAttempts", maxAttempts)
                .param("batch", batchSize)
                .query((rs, n) -> {
                    String payload = rs.getString("payload");
                    return new OutboxMessage(rs.getLong("id"), rs.getString("event_type"), uuid(rs, "aggregate_id"),
                            memberIdOf(payload), payload, rs.getInt("attempts"));
                })
                .list();
    }

    /** Best effort: a payload without a valid memberId still gets delivered, just without a recipient. */
    private UUID memberIdOf(String payload) {
        try {
            JsonNode memberId = json.readTree(payload).get("memberId");
            return memberId == null || !memberId.isString() ? null : UUID.fromString(memberId.stringValue());
        } catch (JacksonException | IllegalArgumentException e) {
            return null;
        }
    }

    @Override
    public void markPublished(long id) {
        jdbc.sql("UPDATE outbox SET published_at = now() WHERE id = :id").param("id", id).update();
    }

    @Override
    public void recordFailure(long id) {
        jdbc.sql("UPDATE outbox SET attempts = attempts + 1 WHERE id = :id").param("id", id).update();
    }

    @Override
    public long countUnpublished() {
        return jdbc.sql("SELECT count(*) FROM outbox WHERE published_at IS NULL").query(Long.class).single();
    }
}
