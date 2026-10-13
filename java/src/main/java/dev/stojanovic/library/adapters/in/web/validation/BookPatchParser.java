package dev.stojanovic.library.adapters.in.web.validation;

import dev.stojanovic.library.domain.error.FieldViolation;
import dev.stojanovic.library.domain.error.ValidationException;
import dev.stojanovic.library.domain.model.BookPatch;
import dev.stojanovic.library.domain.model.Patch;
import tools.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.regex.Pattern;

/**
 * Turns a JSON merge patch (RFC 7396) into a {@link BookPatch}. Hand-written because a typed DTO cannot tell
 * "absent" (keep) from "null" (clear), and because every failing field must be reported, as in the contract's
 * BookUpdate schema.
 */
public final class BookPatchParser {

    private static final Pattern UUID_FORMAT =
            Pattern.compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");
    private static final Set<String> FIELDS = Set.of("title", "description", "publishedYear", "authorIds", "tags");

    private final List<FieldViolation> violations = new ArrayList<>();

    private BookPatchParser() {
    }

    public static BookPatch parse(JsonNode body) {
        return new BookPatchParser().run(body);
    }

    private BookPatch run(JsonNode body) {
        if (body == null || !body.isObject()) {
            throw new ValidationException("body", "must be a JSON object");
        }
        if (body.isEmpty()) {
            throw new ValidationException("body", "must contain at least one property");
        }
        for (Map.Entry<String, JsonNode> entry : body.properties()) {
            if (!FIELDS.contains(entry.getKey())) {
                violations.add(new FieldViolation(entry.getKey(), "Unknown property"));
            }
        }
        BookPatch patch = new BookPatch(
                field(body, "title", false, n -> text(n, "title", 1, 300)),
                field(body, "description", true, n -> text(n, "description", 0, 5000)),
                field(body, "publishedYear", true, this::year),
                field(body, "authorIds", false, this::authorIds),
                field(body, "tags", false, this::tags));
        if (!violations.isEmpty()) {
            throw new ValidationException(violations);
        }
        return patch;
    }

    private <T> Patch<T> field(JsonNode body, String name, boolean nullable, Function<JsonNode, T> reader) {
        if (!body.has(name)) {
            return Patch.absent();
        }
        JsonNode node = body.get(name);
        if (node.isNull()) {
            if (!nullable) {
                violations.add(new FieldViolation(name, "must not be null"));
            }
            return Patch.of(null);
        }
        return Patch.of(reader.apply(node));
    }

    private String text(JsonNode node, String field, int min, int max) {
        if (!node.isString()) {
            violations.add(new FieldViolation(field, "must be a string"));
            return null;
        }
        String value = node.stringValue();
        if (value.length() < min || value.length() > max) {
            violations.add(new FieldViolation(field, "size must be between " + min + " and " + max));
        }
        return value;
    }

    private Integer year(JsonNode node) {
        if (!node.isIntegralNumber() || !node.canConvertToInt()) {
            violations.add(new FieldViolation("publishedYear", "must be an integer"));
            return null;
        }
        int year = node.intValue();
        if (year < 1450 || year > 2100) {
            violations.add(new FieldViolation("publishedYear", "must be between 1450 and 2100"));
        }
        return year;
    }

    private List<UUID> authorIds(JsonNode node) {
        List<String> raw = stringArray(node, "authorIds", 1, 20, 0, Integer.MAX_VALUE);
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < raw.size(); i++) {
            String value = raw.get(i);
            if (value != null && UUID_FORMAT.matcher(value).matches()) {
                ids.add(UUID.fromString(value));
            } else if (value != null) {
                violations.add(new FieldViolation("authorIds." + i, "must be a UUID"));
            }
        }
        return ids;
    }

    private List<String> tags(JsonNode node) {
        return stringArray(node, "tags", 0, 20, 1, 50);
    }

    private List<String> stringArray(JsonNode node, String field, int minItems, int maxItems, int minLength,
                                     int maxLength) {
        if (!node.isArray()) {
            violations.add(new FieldViolation(field, "must be an array"));
            return List.of();
        }
        if (node.size() < minItems || node.size() > maxItems) {
            violations.add(new FieldViolation(field, "size must be between " + minItems + " and " + maxItems));
        }
        List<String> values = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        int i = 0;
        for (JsonNode item : node.values()) {
            String path = field + "." + i++;
            if (!item.isString()) {
                violations.add(new FieldViolation(path, "must be a string"));
                values.add(null);
                continue;
            }
            String value = item.stringValue();
            if (value.length() < minLength || value.length() > maxLength) {
                violations.add(new FieldViolation(path, "size must be between " + minLength + " and " + maxLength));
            }
            if (!seen.add(value)) {
                violations.add(new FieldViolation(field, "must only contain unique elements"));
            }
            values.add(value);
        }
        return values;
    }
}
