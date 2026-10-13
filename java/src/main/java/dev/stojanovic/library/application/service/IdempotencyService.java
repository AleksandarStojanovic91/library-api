package dev.stojanovic.library.application.service;

import dev.stojanovic.library.application.model.IdempotencyRecord;
import dev.stojanovic.library.application.model.IdempotentResult;
import dev.stojanovic.library.application.model.StoredResponse;
import dev.stojanovic.library.application.port.out.IdempotencyStore;
import dev.stojanovic.library.domain.error.ErrorKind;
import dev.stojanovic.library.domain.error.LibraryException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.util.Optional;
import java.util.function.Function;
import java.util.function.Supplier;

/**
 * Runs a request at most once per (subject, Idempotency-Key).
 *
 * <p>The key row is claimed <em>before</em> the work, in the same transaction, so a concurrent duplicate blocks on
 * the uncommitted row and replays the stored response once the first request commits. Business failures (4xx) are
 * stored and replayed too: the work runs inside a savepoint, so its partial writes roll back while the key row and
 * the stored error survive. Anything else (5xx) rolls the whole transaction back, releasing the key for a retry.
 */
@Service
public class IdempotencyService {

    public static final Duration RETENTION = Duration.ofHours(24);

    private final IdempotencyStore store;
    private final TransactionTemplate savepoint;

    public IdempotencyService(IdempotencyStore store, PlatformTransactionManager transactionManager) {
        this.store = store;
        this.savepoint = new TransactionTemplate(transactionManager);
        this.savepoint.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
    }

    @Transactional
    public IdempotentResult execute(String subject, String key, String requestHash, Supplier<StoredResponse> work,
                                    Function<LibraryException, StoredResponse> businessError) {
        // Two attempts: the cleanup job may delete an expired key between our failed claim and the read.
        for (int attempt = 0; attempt < 2; attempt++) {
            if (store.tryClaim(subject, key, requestHash)) {
                StoredResponse response = runInSavepoint(work, businessError);
                store.saveResponse(subject, key, response);
                return new IdempotentResult(response, false);
            }
            Optional<IdempotencyRecord> existing = store.find(subject, key);
            if (existing.isPresent()) {
                return replay(existing.get(), requestHash);
            }
        }
        throw new IllegalStateException("Idempotency key could neither be claimed nor read");
    }

    private StoredResponse runInSavepoint(Supplier<StoredResponse> work,
                                          Function<LibraryException, StoredResponse> businessError) {
        try {
            return savepoint.execute(status -> work.get());
        } catch (LibraryException e) {
            return businessError.apply(e);
        }
    }

    private static IdempotentResult replay(IdempotencyRecord existing, String requestHash) {
        if (!existing.requestHash().equals(requestHash)) {
            throw new LibraryException(ErrorKind.IDEMPOTENCY_KEY_REUSED,
                    "This Idempotency-Key was already used with a different request");
        }
        if (existing.response() == null) {
            // Unreachable while claim and response are written in one transaction; kept as a guard.
            throw new LibraryException(ErrorKind.CONFLICT, "A request with this Idempotency-Key is still in progress");
        }
        return new IdempotentResult(existing.response(), true);
    }

    @Transactional
    public int purgeExpiredKeys() {
        return store.deleteOlderThan(RETENTION);
    }
}
