package dev.stojanovic.library.application.port.out;

import dev.stojanovic.library.application.model.OutboxEvent;
import dev.stojanovic.library.application.model.OutboxMessage;

import java.util.List;

public interface OutboxRepository {

    void append(OutboxEvent event);

    /** Oldest unpublished messages, locked with SKIP LOCKED so several publishers can run side by side. */
    List<OutboxMessage> lockUnpublished(int batchSize, int maxAttempts);

    void markPublished(long id);

    void recordFailure(long id);

    long countUnpublished();
}
