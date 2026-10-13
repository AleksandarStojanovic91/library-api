package dev.stojanovic.library.application.page;

import dev.stojanovic.library.domain.error.ValidationException;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Keyset position: the sort key(s) of the last row of a page plus its id. Values are kept as strings so the
 * transport encoding stays trivial; typed getters reject anything a client could have tampered with.
 */
public record Cursor(Map<String, String> values) {

    public Cursor {
        values = Collections.unmodifiableMap(new LinkedHashMap<>(values));
    }

    /** Builds a cursor from alternating key/value pairs; values may be null. */
    public static Cursor of(String... keysAndValues) {
        if (keysAndValues.length % 2 != 0) {
            throw new IllegalArgumentException("Expected key/value pairs");
        }
        Map<String, String> map = new LinkedHashMap<>();
        for (int i = 0; i < keysAndValues.length; i += 2) {
            map.put(keysAndValues[i], keysAndValues[i + 1]);
        }
        return new Cursor(map);
    }

    public boolean has(String key) {
        return values.containsKey(key);
    }

    public String string(String key) {
        if (!values.containsKey(key)) {
            throw invalid();
        }
        return values.get(key);
    }

    public String requiredString(String key) {
        String value = string(key);
        if (value == null) {
            throw invalid();
        }
        return value;
    }

    public UUID uuid(String key) {
        try {
            return UUID.fromString(requiredString(key));
        } catch (IllegalArgumentException e) {
            throw invalid();
        }
    }

    public Instant instant(String key) {
        try {
            return Instant.parse(requiredString(key));
        } catch (DateTimeParseException e) {
            throw invalid();
        }
    }

    public float floatValue(String key) {
        try {
            float value = Float.parseFloat(requiredString(key));
            if (!Float.isFinite(value)) {
                throw invalid();
            }
            return value;
        } catch (NumberFormatException e) {
            throw invalid();
        }
    }

    /** Nullable integer (e.g. a book without a published year). */
    public Integer nullableInt(String key) {
        String value = string(key);
        try {
            return value == null ? null : Integer.valueOf(value);
        } catch (NumberFormatException e) {
            throw invalid();
        }
    }

    public static ValidationException invalid() {
        return new ValidationException("cursor", "Invalid cursor");
    }
}
