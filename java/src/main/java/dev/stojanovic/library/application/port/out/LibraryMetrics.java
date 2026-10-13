package dev.stojanovic.library.application.port.out;

public interface LibraryMetrics {

    /** Counted after commit, so rolled-back attempts and idempotent replays are not counted. */
    void loanBorrowed();

    void loanReturned();

    void outboxBacklog(long unpublished);
}
