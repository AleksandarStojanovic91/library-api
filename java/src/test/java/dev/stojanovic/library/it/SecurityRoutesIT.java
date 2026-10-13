package dev.stojanovic.library.it;

import dev.stojanovic.library.it.support.Api;
import dev.stojanovic.library.it.support.Fixtures;
import dev.stojanovic.library.it.support.IntegrationTest;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Spring Security lists the protected routes explicitly (so unknown routes are 404, not 401). This test is the safety
 * net for that choice: every operation the contract marks as secured must answer 401 without a token.
 */
class SecurityRoutesIT extends IntegrationTest {

    @Test
    void everySecuredOperationInTheContractRequiresAToken() {
        var operations = contract().protectedOperations();
        assertThat(operations).hasSizeGreaterThan(15);
        for (String operation : operations) {
            String method = operation.substring(0, operation.indexOf(' '));
            String path = operation.substring(operation.indexOf(' ') + 1).replaceAll("\\{[^}]+}", Fixtures.MISSING_ID);
            Api.Call call = switch (method) {
                case "GET" -> api.get(path);
                case "POST" -> api.post(path).json("{}");
                case "PATCH" -> api.patch(path).header("If-Match", "\"1\"").json("{}");
                case "PUT" -> api.put(path).json("{}");
                case "DELETE" -> api.delete(path);
                default -> throw new IllegalStateException(method);
            };
            Api.Response response = call.send();
            assertThat(response.status()).as(operation).isEqualTo(401);
        }
    }

    @Test
    void unknownRoutesAreNotFoundEvenWithoutAToken() {
        Api.Response response = api.get("/api/v1/does-not-exist").send();
        assertThat(response.status()).isEqualTo(404);
        assertThat(response.code()).isEqualTo("not-found");
        assertThat(response.header("RateLimit-Limit")).isNotNull();
    }
}
