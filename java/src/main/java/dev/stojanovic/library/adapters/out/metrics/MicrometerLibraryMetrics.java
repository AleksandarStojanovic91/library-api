package dev.stojanovic.library.adapters.out.metrics;

import dev.stojanovic.library.application.port.out.LibraryMetrics;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.concurrent.atomic.AtomicLong;

/** Exposed by Prometheus as library_loans_borrowed_total, library_loans_returned_total, library_outbox_backlog. */
@Component
class MicrometerLibraryMetrics implements LibraryMetrics {

    private final Counter loansBorrowed;
    private final Counter loansReturned;
    private final AtomicLong outboxBacklog = new AtomicLong();

    MicrometerLibraryMetrics(MeterRegistry registry) {
        this.loansBorrowed = Counter.builder("library.loans.borrowed").description("Loans created (books borrowed)").register(registry);
        this.loansReturned = Counter.builder("library.loans.returned").description("Loans returned").register(registry);
        Gauge.builder("library.outbox.backlog", outboxBacklog, AtomicLong::get)
                .description("Outbox events not yet published")
                .register(registry);
    }

    @Override
    public void loanBorrowed() {
        afterCommit(loansBorrowed::increment);
    }

    @Override
    public void loanReturned() {
        afterCommit(loansReturned::increment);
    }

    @Override
    public void outboxBacklog(long unpublished) {
        outboxBacklog.set(unpublished);
    }

    private static void afterCommit(Runnable action) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            action.run();
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                action.run();
            }
        });
    }
}
