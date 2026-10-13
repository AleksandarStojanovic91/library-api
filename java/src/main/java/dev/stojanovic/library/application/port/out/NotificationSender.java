package dev.stojanovic.library.application.port.out;

import dev.stojanovic.library.application.model.OutboxMessage;

/** Delivers one outbox event to the outside world (here: the notifications table, standing in for e-mail). */
public interface NotificationSender {

    void send(OutboxMessage message);
}
