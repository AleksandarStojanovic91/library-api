package dev.stojanovic.library.application.model;

/** A stored idempotency key; {@code response} is null only while the first request is still in flight. */
public record IdempotencyRecord(String requestHash, StoredResponse response) {
}
