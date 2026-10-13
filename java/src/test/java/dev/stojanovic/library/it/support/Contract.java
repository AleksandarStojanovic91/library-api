package dev.stojanovic.library.it.support;

import com.networknt.schema.Error;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SpecificationVersion;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
import tools.jackson.dataformat.yaml.YAMLMapper;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Contract-conformance check, applied to every response the integration tests see. The DTOs are hand-written
 * (see README, "Contract first, hand-written DTOs"), so this is what keeps them honest: the documented status for
 * the operation, the response schema from contract/openapi.yaml with objects closed (no undeclared fields, as the
 * shared api-tests suite does), millisecond UTC timestamps, problem+json for errors and the cross-cutting headers.
 */
public final class Contract {

    private static final Pattern TIMESTAMP = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$");
    private static final Pattern ISO_LIKE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}T");

    private final JsonNode openapi;
    private final ObjectNode components;
    private final SchemaRegistry registry = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12);
    private final Map<String, Schema> schemas = new ConcurrentHashMap<>();

    public Contract() {
        try (InputStream in = Contract.class.getResourceAsStream("/contract/openapi.yaml")) {
            openapi = new YAMLMapper().readTree(in);
        } catch (IOException e) {
            throw new IllegalStateException("contract/openapi.yaml is not on the test classpath", e);
        }
        components = (ObjectNode) openapi.get("components").deepCopy();
        components.get("schemas").properties().forEach(e -> {
            if (!e.getKey().equals("Problem")) {
                close(e.getValue());
            }
        });
    }

    /** Adds additionalProperties:false to every object schema that lists properties (Problem stays open). */
    private static void close(JsonNode schema) {
        if (schema instanceof ObjectNode object) {
            if (object.has("properties") && !object.has("additionalProperties")) {
                object.put("additionalProperties", false);
            }
            object.values().forEach(Contract::close);
        } else if (schema instanceof ArrayNode array) {
            array.values().forEach(Contract::close);
        }
    }

    public void check(Api.Response response) {
        String path = response.path().split("\\?")[0];
        if (response.status() >= 400) {
            assertProblem(response, path);
        }
        JsonNode operation = operation(response.method(), path);
        if (operation == null) {
            return; // /docs, /openapi.yaml, unknown routes: only the problem shape applies
        }
        JsonNode documented = operation.path("responses").get(Integer.toString(response.status()));
        if (documented == null) {
            if (response.status() < 400) {
                fail(response, "status " + response.status() + " is not documented for this operation");
            }
            return; // undocumented error statuses are contract gaps, still problem documents (checked above)
        }
        if (documented.has("$ref")) {
            documented = resolve(documented.get("$ref").asString());
        }
        JsonNode content = documented.get("content");
        if (content == null) {
            if (!response.body().isEmpty()) {
                fail(response, "expected an empty body");
            }
            return;
        }
        JsonNode jsonSchema = content.path("application/json").get("schema");
        if (jsonSchema == null) {
            jsonSchema = content.path("application/problem+json").get("schema");
        }
        if (jsonSchema != null && response.json() != null) {
            List<Error> errors = schemaFor(jsonSchema).validate(response.json());
            if (!errors.isEmpty()) {
                fail(response, "does not match the contract schema: " + errors);
            }
            assertTimestamps(response, response.json());
        }
    }

    private void assertProblem(Api.Response response, String path) {
        if (!String.valueOf(response.header("Content-Type")).startsWith("application/problem+json")) {
            fail(response, "errors must be application/problem+json");
        }
        JsonNode problem = response.json();
        List<Error> errors = schemaFor(components.at("/schemas/Problem")).validate(problem);
        if (!errors.isEmpty()) {
            fail(response, "is not a valid Problem: " + errors);
        }
        if (problem.get("status").asInt() != response.status()
                || !problem.get("type").asString().equals("https://library.example/problems/" + problem.get("code").asString())
                || !path.equals(problem.path("instance").asString())
                || !problem.path("requestId").asString().equals(response.header("X-Request-Id"))) {
            fail(response, "problem status/type/instance/requestId do not match the response");
        }
        if (response.status() == 401 && !String.valueOf(response.header("WWW-Authenticate")).startsWith("Bearer")) {
            fail(response, "401 without WWW-Authenticate: Bearer");
        }
    }

    private void assertTimestamps(Api.Response response, JsonNode node) {
        if (node.isString() && ISO_LIKE.matcher(node.asString()).find()
                && !TIMESTAMP.matcher(node.asString()).matches()) {
            fail(response, "timestamp " + node.asString() + " is not UTC with milliseconds");
        }
        node.values().forEach(child -> assertTimestamps(response, child));
    }

    private JsonNode operation(String method, String path) {
        JsonNode paths = openapi.get("paths");
        JsonNode best = null;
        int bestLiterals = -1;
        for (Map.Entry<String, JsonNode> entry : paths.properties()) {
            String[] template = entry.getKey().split("/");
            String[] actual = path.split("/");
            if (template.length != actual.length) {
                continue;
            }
            int literals = 0;
            boolean matches = true;
            for (int i = 0; i < template.length && matches; i++) {
                if (template[i].startsWith("{")) {
                    continue;
                }
                matches = template[i].equals(actual[i]);
                literals++;
            }
            if (matches && literals > bestLiterals && entry.getValue().has(method.toLowerCase())) {
                best = entry.getValue().get(method.toLowerCase());
                bestLiterals = literals;
            }
        }
        return best;
    }

    private JsonNode resolve(String ref) {
        return openapi.at(ref.substring(1));
    }

    private Schema schemaFor(JsonNode schema) {
        return schemas.computeIfAbsent(schema.toString(), key -> {
            ObjectNode root = (ObjectNode) schema.deepCopy();
            root.put("$schema", "https://json-schema.org/draft/2020-12/schema");
            root.set("components", components);
            return registry.getSchema(root);
        });
    }

    private static void fail(Api.Response response, String message) {
        throw new AssertionError("Contract violation: " + response + "\n  " + message);
    }

    /** Every operation that requires authentication, as {@code "METHOD /path/template"} (for SecurityRoutesIT). */
    public List<String> protectedOperations() {
        boolean securedByDefault = openapi.has("security") && !openapi.get("security").isEmpty();
        List<String> result = new java.util.ArrayList<>();
        openapi.get("paths").properties().forEach(path -> path.getValue().properties().forEach(op -> {
            if (op.getKey().equals("parameters")) {
                return;
            }
            JsonNode security = op.getValue().get("security");
            boolean secured = security == null ? securedByDefault : !security.isEmpty();
            if (secured) {
                result.add(op.getKey().toUpperCase() + " " + path.getKey());
            }
        }));
        return result;
    }
}
