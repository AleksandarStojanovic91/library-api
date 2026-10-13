package dev.stojanovic.library.adapters.in.web.support;

import dev.stojanovic.library.adapters.in.web.dto.LoanCreateRequest;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class RequestHashingTest {

    private final JsonMapper json = JsonMapper.builder().build();
    private final RequestHashing hashing = new RequestHashing(json);
    private final UUID book = UUID.fromString("20000000-0000-4000-8000-000000000001");

    @Test
    void equivalentBodiesHashTheSame() {
        String a = hashing.hash("POST", "/api/v2/loans", new LoanCreateRequest(book, null));
        String b = hashing.hash("POST", "/api/v2/loans", json.readTree("{ \"memberId\": null, \"bookId\": \"" + book + "\" }"));
        assertThat(a).isEqualTo(b).hasSize(64);
    }

    @Test
    void canonicalFormIsSortedAndWithoutNulls() {
        var node = json.readTree("{\"z\":1,\"a\":{\"y\":null,\"b\":[{\"d\":1,\"c\":2}]}}");
        assertThat(json.writeValueAsString(hashing.canonical(node))).isEqualTo("{\"a\":{\"b\":[{\"c\":2,\"d\":1}]},\"z\":1}");
    }

    @Test
    void methodPathAndBodyAllMatter() {
        String v2 = hashing.hash("POST", "/api/v2/loans", new LoanCreateRequest(book, null));
        assertThat(hashing.hash("POST", "/api/v1/loans", new LoanCreateRequest(book, null))).isNotEqualTo(v2);
        assertThat(hashing.hash("POST", "/api/v2/loans", new LoanCreateRequest(UUID.randomUUID(), null))).isNotEqualTo(v2);
        assertThat(hashing.hash("PUT", "/api/v2/loans", new LoanCreateRequest(book, null))).isNotEqualTo(v2);
    }

    @Test
    void isSha256Hex() {
        assertThat(RequestHashing.sha256("abc"))
                .isEqualTo("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}
