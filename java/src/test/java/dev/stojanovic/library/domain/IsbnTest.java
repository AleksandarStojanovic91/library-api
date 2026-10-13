package dev.stojanovic.library.domain;

import dev.stojanovic.library.domain.model.Isbn;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;

class IsbnTest {

    @ParameterizedTest
    @ValueSource(strings = {"9780132350884", "9781449373320", "9780321125217", "9780321146533", "9788652117895",
            "9790000000001"})
    void acceptsValidIsbn13(String isbn) {
        assertThat(Isbn.isValid(isbn)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"9780132350885", "9780132350880", "1234567890123", "978013235088", "97801323508840",
            "978013235088X", "978-0132350884", " 9780132350884"})
    void rejectsWrongCheckDigitOrFormat(String isbn) {
        assertThat(Isbn.isValid(isbn)).isFalse();
    }

    @ParameterizedTest
    @NullAndEmptySource
    void rejectsMissing(String isbn) {
        assertThat(Isbn.isValid(isbn)).isFalse();
    }

    @Test
    void checkDigitUsesAlternatingWeightsOneAndThree() {
        // 9*1 + 7*3 + 9*1 = 39 -> (10 - 9) % 10 = 1
        assertThat(Isbn.checkDigit("979000000000")).isEqualTo(1);
        // 9 + 21 + 8 + 2 = 40 -> a multiple of ten gives check digit 0, not 10
        assertThat(Isbn.checkDigit("978000000020")).isZero();
        assertThat(Isbn.isValid("9780000000200")).isTrue();
    }
}
