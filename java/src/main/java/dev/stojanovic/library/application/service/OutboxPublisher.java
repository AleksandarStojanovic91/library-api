package dev.stojanovic.library.application.service;

import dev.stojanovic.library.application.model.OutboxMessage;
import dev.stojanovic.library.application.port.out.LibraryMetrics;
import dev.stojanovic.library.application.port.out.NotificationSender;
import dev.stojanovic.library.application.port.out.OutboxRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;

/**
 * Publishes the transactional outbox. Rows are locked with SKIP LOCKED, so several instances share the work without
 * double delivery; each message is sent inside its own savepoint so one poison message cannot block the batch.
 */
@Service
public class OutboxPublisher {

    /** After this many failed attempts a message is parked (left unpublished) for a human to look at. */
    public static final int MAX_ATTEMPTS = 10;

    private static final Logger log = LoggerFactory.getLogger(OutboxPublisher.class);

    private final OutboxRepository outbox;
    private final NotificationSender sender;
    private final LibraryMetrics metrics;
    private final TransactionTemplate savepoint;

    public OutboxPublisher(OutboxRepository outbox, NotificationSender sender, LibraryMetrics metrics,
                           PlatformTransactionManager transactionManager) {
        this.outbox = outbox;
        this.sender = sender;
        this.metrics = metrics;
        this.savepoint = new TransactionTemplate(transactionManager);
        this.savepoint.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
    }

    @Transactional
    public int publishBatch(int batchSize) {
        List<OutboxMessage> batch = outbox.lockUnpublished(batchSize, MAX_ATTEMPTS);
        int published = 0;
        for (OutboxMessage message : batch) {
            try {
                savepoint.executeWithoutResult(status -> {
                    sender.send(message);
                    outbox.markPublished(message.id());
                });
                published++;
            } catch (RuntimeException e) {
                log.warn("Publishing outbox message {} ({}) failed on attempt {}: {}",
                        message.id(), message.eventType(), message.attempts() + 1, e.getMessage());
                outbox.recordFailure(message.id());
            }
        }
        metrics.outboxBacklog(outbox.countUnpublished());
        return published;
    }
}
