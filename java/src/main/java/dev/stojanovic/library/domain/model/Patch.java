package dev.stojanovic.library.domain.model;

/**
 * One field of a JSON merge patch (RFC 7396): either absent (leave unchanged) or present, where a present
 * {@code null} means "clear the value".
 */
public sealed interface Patch<T> {

    record Absent<T>() implements Patch<T> {
    }

    record Present<T>(T value) implements Patch<T> {
    }

    static <T> Patch<T> absent() {
        return new Absent<>();
    }

    static <T> Patch<T> of(T value) {
        return new Present<>(value);
    }

    default boolean isPresent() {
        return this instanceof Present<T>;
    }

    default T applyTo(T current) {
        return this instanceof Present<T>(T value) ? value : current;
    }
}
