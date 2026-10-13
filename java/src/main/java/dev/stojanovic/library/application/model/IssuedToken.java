package dev.stojanovic.library.application.model;

public record IssuedToken(String accessToken, long expiresInSeconds) {
}
