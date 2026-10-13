package dev.stojanovic.library.domain.model;

public enum ReservationStatus {
    WAITING,
    READY,
    FULFILLED,
    CANCELLED,
    EXPIRED;

    /** WAITING and READY reservations are "open": they still occupy the member's place in the queue. */
    public boolean isOpen() {
        return this == WAITING || this == READY;
    }
}
