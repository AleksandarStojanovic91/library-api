package dev.stojanovic.library.application.model;

import java.util.Map;

/** An HTTP response captured for idempotent replay: status, JSON body and the headers worth replaying. */
public record StoredResponse(int status, String body, Map<String, String> headers) {

    public StoredResponse {
        headers = Map.copyOf(headers);
    }
}
