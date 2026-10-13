package dev.stojanovic.library.application.port.out;

import dev.stojanovic.library.application.model.IdempotencyRecord;
import dev.stojanovic.library.application.model.StoredResponse;

import java.time.Duration;
import java.util.Optional;

public interface IdempotencyStore {

    /**
     * Claims the key for this transaction ({@code INSERT ... ON CONFLICT DO NOTHING}). A concurrent claim of the same
     * key blocks on the uncommitted row until the first transaction ends, then returns false.
     */
    boolean tryClaim(String subject, String key, String requestHash);

    Optional<IdempotencyRecord> find(String subject, String key);

    void saveResponse(String subject, String key, StoredResponse response);

    int deleteOlderThan(Duration age);
}
