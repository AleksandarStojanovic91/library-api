package dev.stojanovic.library.adapters.out.security;

import dev.stojanovic.library.application.port.out.PasswordHasher;
import dev.stojanovic.library.domain.error.ValidationException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;

@Component
class BcryptPasswordHasher implements PasswordHasher {

    /** Cost 10, matching the seeded hashes. */
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(10);

    /** bcrypt only uses 72 bytes; rather than silently ignoring the rest, such passwords are rejected. */
    static final int MAX_BYTES = 72;

    @Override
    public String hash(String rawPassword) {
        if (rawPassword.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            throw new ValidationException("password", "must be at most " + MAX_BYTES + " bytes (bcrypt limit)");
        }
        return encoder.encode(rawPassword);
    }

    @Override
    public boolean matches(String rawPassword, String hash) {
        if (rawPassword.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            return false; // could never have been set, and bcrypt would compare only a 72-byte prefix
        }
        return encoder.matches(rawPassword, hash);
    }
}
