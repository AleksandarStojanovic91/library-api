package dev.stojanovic.library.adapters.in.web.support;

import dev.stojanovic.library.application.page.Cursor;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

/** Cursor &lt;-&gt; opaque token: base64url (no padding) of a flat JSON object of string/null values. */
@Component
public class CursorCodec {

    private final JsonMapper json;

    public CursorCodec(JsonMapper json) {
        this.json = json;
    }

    public String encode(Cursor cursor) {
        return cursor == null ? null
                : Base64.getUrlEncoder().withoutPadding().encodeToString(json.writeValueAsBytes(cursor.values()));
    }

    public Cursor decode(String token) {
        if (token == null) {
            return null;
        }
        try {
            JsonNode node = json.readTree(Base64.getUrlDecoder().decode(token));
            if (node == null || !node.isObject() || node.isEmpty()) {
                throw Cursor.invalid();
            }
            Map<String, String> values = new LinkedHashMap<>();
            for (Map.Entry<String, JsonNode> entry : node.properties()) {
                JsonNode value = entry.getValue();
                if (!value.isNull() && !value.isString()) {
                    throw Cursor.invalid();
                }
                values.put(entry.getKey(), value.isNull() ? null : value.stringValue());
            }
            return new Cursor(values);
        } catch (IllegalArgumentException | JacksonException e) {
            throw Cursor.invalid();
        }
    }
}
