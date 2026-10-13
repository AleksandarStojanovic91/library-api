package dev.stojanovic.library.application.model;

import java.util.Map;
import java.util.UUID;

/** An event recorded in the same transaction as the change it describes (transactional outbox). */
public record OutboxEvent(String aggregateType, UUID aggregateId, String eventType, Map<String, Object> payload) {

    public OutboxEvent {
        payload = Map.copyOf(payload);
    }
}
