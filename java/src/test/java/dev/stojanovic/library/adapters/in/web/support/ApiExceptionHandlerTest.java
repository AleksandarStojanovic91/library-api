package dev.stojanovic.library.adapters.in.web.support;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

class ApiExceptionHandlerTest {

    @ParameterizedTest
    @CsvSource({"authorIds[0], authorIds.0", "tags[12], tags.12", "title, title", "a[1].b[2], a.1.b.2"})
    void springPropertyPathsBecomeJsonPointerStyle(String springPath, String expected) {
        assertThat(ApiExceptionHandler.jsonPointer(springPath)).isEqualTo(expected);
    }
}
