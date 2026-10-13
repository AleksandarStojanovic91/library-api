package dev.stojanovic.library.application.model;

/** A book plus whether it came from the cache (exposed as {@code X-Cache}). */
public record CachedBook(BookView book, boolean cacheHit) {
}
