package dev.stojanovic.library.adapters.in.web.dto;

public record TokenResponse(String accessToken, String tokenType, long expiresIn) {
}
