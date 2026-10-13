package dev.stojanovic.library.adapters.in.web.support;

import dev.stojanovic.library.application.page.Cursor;
import dev.stojanovic.library.domain.error.ValidationException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CursorCodecTest {

    private final CursorCodec codec = new CursorCodec(JsonMapper.builder().build());

    @Test
    void roundTripsIncludingNullsAndUnicode() {
        Cursor cursor = Cursor.of("s", "year", "y", null, "t", "na drini ćuprija", "id",
                "20000000-0000-4000-8000-000000000005");
        String token = codec.encode(cursor);
        assertThat(token).doesNotContain("=", "+", "/");
        assertThat(codec.decode(token)).isEqualTo(cursor);
    }

    @Test
    void tokenIsBase64UrlOfAJsonObject() {
        String token = codec.encode(Cursor.of("t", "clean code", "id", "abc"));
        String json = new String(Base64.getUrlDecoder().decode(token), StandardCharsets.UTF_8);
        assertThat(json).isEqualTo("{\"t\":\"clean code\",\"id\":\"abc\"}");
    }

    @Test
    void acceptsPaddedTokens() {
        String padded = Base64.getUrlEncoder().encodeToString("{\"t\":\"x\"}".getBytes(StandardCharsets.UTF_8));
        assertThat(codec.decode(padded).string("t")).isEqualTo("x");
    }

    @ParameterizedTest
    @ValueSource(strings = {"zzz", "!!!", "e30", "W10", "eyJ0IjoxfQ", "bnVsbA", "eyJ0Ijp7fX0"})
    void rejectsAnythingElse(String token) {
        // "e30" = {}, "W10" = [], "eyJ0IjoxfQ" = {"t":1}, "bnVsbA" = null, "eyJ0Ijp7fX0" = {"t":{}}
        assertThatThrownBy(() -> codec.decode(token)).isInstanceOf(ValidationException.class);
    }

    @Test
    void nullMeansFirstOrLastPage() {
        assertThat(codec.encode(null)).isNull();
        assertThat(codec.decode(null)).isNull();
    }
}
