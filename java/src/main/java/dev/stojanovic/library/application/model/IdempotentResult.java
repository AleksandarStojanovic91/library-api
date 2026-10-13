package dev.stojanovic.library.application.model;

public record IdempotentResult(StoredResponse response, boolean replayed) {
}
