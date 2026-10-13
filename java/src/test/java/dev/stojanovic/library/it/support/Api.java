package dev.stojanovic.library.it.support;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * A deliberately plain HTTP client: the tests talk to the running server over real sockets, exactly like a client
 * would, with no Spring test plumbing in between. Every response is checked against the shared contract.
 */
public class Api {

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final String baseUrl;
    private final JsonMapper json;
    private final Contract contract;

    public Api(int port, JsonMapper json, Contract contract) {
        this.baseUrl = "http://localhost:" + port;
        this.json = json;
        this.contract = contract;
    }

    public Call get(String path) {
        return new Call("GET", path);
    }

    public Call post(String path) {
        return new Call("POST", path);
    }

    public Call patch(String path) {
        return new Call("PATCH", path);
    }

    public Call put(String path) {
        return new Call("PUT", path);
    }

    public Call delete(String path) {
        return new Call("DELETE", path);
    }

    public final class Call {
        private final String method;
        private final String path;
        private final Map<String, String> headers = new LinkedHashMap<>();
        private String body;

        private Call(String method, String path) {
            this.method = method;
            this.path = path;
        }

        public Call token(String token) {
            return token == null ? this : header("Authorization", "Bearer " + token);
        }

        public Call header(String name, String value) {
            headers.put(name, value);
            return this;
        }

        /** A map/record is serialised; a String is sent verbatim (for malformed-JSON tests). */
        public Call json(Object payload) {
            headers.putIfAbsent("Content-Type", "application/json");
            body = payload instanceof String raw ? raw : json.writeValueAsString(payload);
            return this;
        }

        public Response send() {
            HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(baseUrl + path))
                    .timeout(Duration.ofSeconds(30))
                    .method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                            : HttpRequest.BodyPublishers.ofString(body));
            headers.forEach(request::header);
            try {
                HttpResponse<String> response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
                Response result = new Response(method, path, response.statusCode(), response.headers().map(),
                        response.body(), parse(response));
                contract.check(result);
                return result;
            } catch (IOException e) {
                throw new IllegalStateException(method + " " + path + " failed", e);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
            }
        }

        private JsonNode parse(HttpResponse<String> response) {
            String type = response.headers().firstValue("Content-Type").orElse("");
            return type.contains("json") && !response.body().isEmpty() ? json.readTree(response.body()) : null;
        }
    }

    public record Response(String method, String path, int status, Map<String, List<String>> headers, String body,
                           JsonNode json) {

        public String header(String name) {
            return headers.entrySet().stream()
                    .filter(e -> e.getKey().equalsIgnoreCase(name))
                    .map(e -> e.getValue().getFirst())
                    .findFirst().orElse(null);
        }

        public Optional<String> optionalHeader(String name) {
            return Optional.ofNullable(header(name));
        }

        public String text(String field) {
            JsonNode node = json.get(field);
            return node == null || node.isNull() ? null : node.asString();
        }

        public String id() {
            return text("id");
        }

        public String code() {
            return text("code");
        }

        @Override
        public String toString() {
            return method + " " + path + " -> " + status + " " + body;
        }
    }
}
