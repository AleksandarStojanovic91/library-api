package dev.stojanovic.library.application.model;

public record RateLimitDecision(boolean allowed, long limit, long remaining, long resetSeconds) {
}
