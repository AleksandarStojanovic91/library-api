package dev.stojanovic.library.application.model;

import java.util.UUID;

/** An unpublished outbox row as the publisher sees it; {@code payloadJson} is passed through untouched. */
public record OutboxMessage(long id, String eventType, UUID aggregateId, UUID memberId, String payloadJson,
                            int attempts) {
}
