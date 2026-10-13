package dev.stojanovic.library.domain.error;

/** One invalid input field; {@code field} uses JSON-pointer style without the leading slash ({@code authorIds.0}). */
public record FieldViolation(String field, String message) {
}
