package dev.stojanovic.library.adapters.out.cache;

import dev.stojanovic.library.application.model.BookView;
import dev.stojanovic.library.application.port.out.BookCache;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;
import java.util.Optional;
import java.util.UUID;

@Component
class RedisBookCache implements BookCache {

    static final Duration TTL = Duration.ofSeconds(60);

    private final StringRedisTemplate redis;
    private final JsonMapper json;
    private final RedisGuard guard;

    RedisBookCache(StringRedisTemplate redis, JsonMapper json, RedisGuard guard) {
        this.redis = redis;
        this.json = json;
        this.guard = guard;
    }

    @Override
    public Optional<BookView> get(UUID bookId) {
        return guard.call("cache read", () -> redis.opsForValue().get(key(bookId))).flatMap(cached -> {
            try {
                return Optional.of(json.readValue(cached, BookView.class));
            } catch (JacksonException e) {
                // e.g. an entry written by an older version of the service: treat as a miss
                return Optional.empty();
            }
        });
    }

    @Override
    public void put(BookView book) {
        guard.run("cache write", () -> redis.opsForValue().set(key(book.id()), json.writeValueAsString(book), TTL));
    }

    /**
     * Evicting before commit would let a concurrent reader re-cache the old row between our delete and our commit,
     * so inside a transaction the delete is deferred until after commit.
     */
    @Override
    public void evict(UUID bookId) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    delete(bookId);
                }
            });
        } else {
            delete(bookId);
        }
    }

    private void delete(UUID bookId) {
        guard.run("cache evict", () -> redis.delete(key(bookId)));
    }

    private static String key(UUID bookId) {
        return "book:" + bookId;
    }
}
