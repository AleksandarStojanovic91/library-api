package dev.stojanovic.library.adapters.out.security;

import dev.stojanovic.library.domain.error.ValidationException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class BcryptPasswordHasherTest {

    private final BcryptPasswordHasher hasher = new BcryptPasswordHasher();

    @Test
    void verifiesTheSeededHashes() {
        assertThat(hasher.matches("member-pass-123", "$2a$10$2y8pGw4WYn0XuOuQR857b.1wYfKCIsmZMTYqWRbTerXZqsOjocNkG")).isTrue();
        assertThat(hasher.matches("member-pass-124", "$2a$10$2y8pGw4WYn0XuOuQR857b.1wYfKCIsmZMTYqWRbTerXZqsOjocNkG")).isFalse();
    }

    @Test
    void refusesPasswordsBcryptWouldTruncate() {
        String seventyTwo = "x".repeat(72);
        String hash = hasher.hash(seventyTwo);
        assertThat(hasher.matches(seventyTwo + "y", hash)).as("no prefix matches").isFalse();
        assertThatThrownBy(() -> hasher.hash("é".repeat(37))).isInstanceOf(ValidationException.class); // 74 bytes
    }
}
