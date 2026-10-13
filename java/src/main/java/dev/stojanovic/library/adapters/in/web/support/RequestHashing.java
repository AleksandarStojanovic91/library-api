package dev.stojanovic.library.adapters.in.web.support;

import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import java.util.TreeMap;

/**
 * Fingerprint of a request for idempotency: sha256 of {@code METHOD path canonical-json-body}. The body is the
 * parsed request object re-serialised with sorted keys and without nulls, so whitespace, key order and explicit
 * {@code null}s do not make two equivalent requests look different.
 */
@Component
public class RequestHashing {

    private final JsonMapper json;

    public RequestHashing(JsonMapper json) {
        this.json = json;
    }

    public String hash(String method, String path, Object body) {
        String canonical = json.writeValueAsString(canonical(json.valueToTree(body)));
        return sha256(method + " " + path + " " + canonical);
    }

    JsonNode canonical(JsonNode node) {
        if (node.isObject()) {
            Map<String, JsonNode> sorted = new TreeMap<>();
            for (Map.Entry<String, JsonNode> e : node.properties()) {
                if (!e.getValue().isNull()) {
                    sorted.put(e.getKey(), canonical(e.getValue()));
                }
            }
            ObjectNode result = json.createObjectNode();
            sorted.forEach(result::set);
            return result;
        }
        if (node.isArray()) {
            ArrayNode result = json.createArrayNode();
            node.values().forEach(v -> result.add(canonical(v)));
            return result;
        }
        return node;
    }

    static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is always available", e);
        }
    }
}
