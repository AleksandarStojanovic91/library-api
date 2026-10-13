package dev.stojanovic.library.adapters.out.persistence;

import dev.stojanovic.library.application.model.IdempotencyRecord;
import dev.stojanovic.library.application.model.StoredResponse;
import dev.stojanovic.library.application.port.out.IdempotencyStore;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;
import java.util.Map;
import java.util.Optional;

@Repository
class JdbcIdempotencyStore implements IdempotencyStore {

    private static final TypeReference<Map<String, String>> HEADERS = new TypeReference<>() {
    };

    private final JdbcClient jdbc;
    private final JsonMapper json;

    JdbcIdempotencyStore(JdbcClient jdbc, JsonMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Override
    public boolean tryClaim(String subject, String key, String requestHash) {
        return jdbc.sql("INSERT INTO idempotency_keys (subject, key, request_hash) VALUES (:subject, :key, :hash)"
                        + " ON CONFLICT (subject, key) DO NOTHING")
                .param("subject", subject).param("key", key).param("hash", requestHash)
                .update() == 1;
    }

    @Override
    public Optional<IdempotencyRecord> find(String subject, String key) {
        return jdbc.sql("SELECT request_hash, response_status, response_body::text AS body,"
                        + " response_headers::text AS headers FROM idempotency_keys WHERE subject = :subject AND key = :key")
                .param("subject", subject).param("key", key)
                .query((rs, n) -> {
                    int status = rs.getInt("response_status");
                    StoredResponse response = rs.wasNull() ? null : new StoredResponse(status, rs.getString("body"),
                            json.readValue(rs.getString("headers"), HEADERS));
                    return new IdempotencyRecord(rs.getString("request_hash"), response);
                })
                .optional();
    }

    @Override
    public void saveResponse(String subject, String key, StoredResponse response) {
        jdbc.sql("UPDATE idempotency_keys SET response_status = :status, response_body = CAST(:body AS jsonb),"
                        + " response_headers = CAST(:headers AS jsonb) WHERE subject = :subject AND key = :key")
                .param("subject", subject).param("key", key)
                .param("status", response.status())
                .param("body", response.body())
                .param("headers", json.writeValueAsString(response.headers()))
                .update();
    }

    @Override
    public int deleteOlderThan(Duration age) {
        // created_at is an audit column (database clock), so the cut-off uses the database clock too
        return jdbc.sql("DELETE FROM idempotency_keys WHERE created_at < now() - make_interval(secs => CAST(:secs AS double precision))")
                .param("secs", age.toSeconds()).update();
    }
}
