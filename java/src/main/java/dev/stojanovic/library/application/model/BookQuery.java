package dev.stojanovic.library.application.model;

import java.util.UUID;

/** Filters for listing books; every field is optional ({@code available=false}: no AVAILABLE copy). */
public record BookQuery(String text, UUID authorId, String tag, Boolean available, BookSort sort) {

    public boolean hasText() {
        return text != null && !text.isBlank();
    }
}
