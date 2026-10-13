package dev.stojanovic.library.adapters.out.persistence;

import dev.stojanovic.library.application.model.OutboxMessage;
import dev.stojanovic.library.application.port.out.NotificationSender;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/** Stands in for e-mail or a message broker; UNIQUE(outbox_id) makes redelivery harmless. */
@Component
class JdbcNotificationSender implements NotificationSender {

    private final JdbcClient jdbc;

    JdbcNotificationSender(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void send(OutboxMessage message) {
        jdbc.sql("INSERT INTO notifications (outbox_id, member_id, kind, payload)"
                        + " VALUES (:outboxId, :memberId, :kind, CAST(:payload AS jsonb))"
                        + " ON CONFLICT (outbox_id) DO NOTHING")
                .param("outboxId", message.id())
                .param("memberId", message.memberId())
                .param("kind", message.eventType())
                .param("payload", message.payloadJson())
                .update();
    }
}
