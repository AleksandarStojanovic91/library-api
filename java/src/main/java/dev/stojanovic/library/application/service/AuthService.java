package dev.stojanovic.library.application.service;

import dev.stojanovic.library.application.model.IssuedToken;
import dev.stojanovic.library.application.model.MemberCredentials;
import dev.stojanovic.library.application.port.out.MemberRepository;
import dev.stojanovic.library.application.port.out.PasswordHasher;
import dev.stojanovic.library.application.port.out.TokenIssuer;
import dev.stojanovic.library.domain.error.ErrorKind;
import dev.stojanovic.library.domain.error.LibraryException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

@Service
public class AuthService {

    private final MemberRepository members;
    private final PasswordHasher passwords;
    private final TokenIssuer tokens;
    /** Compared against when the e-mail is unknown, so both failure paths cost one bcrypt check. */
    private final String timingDummyHash;

    public AuthService(MemberRepository members, PasswordHasher passwords, TokenIssuer tokens) {
        this.members = members;
        this.passwords = passwords;
        this.tokens = tokens;
        this.timingDummyHash = passwords.hash(UUID.randomUUID().toString());
    }

    @Transactional(readOnly = true)
    public IssuedToken issueToken(String email, String password) {
        Optional<MemberCredentials> member = members.findCredentialsByEmail(email);
        if (member.isEmpty()) {
            passwords.matches(password, timingDummyHash);
            throw invalidCredentials();
        }
        if (!passwords.matches(password, member.get().passwordHash())) {
            throw invalidCredentials();
        }
        return tokens.issue(member.get());
    }

    /** Same answer for "no such e-mail" and "wrong password": no user enumeration. */
    private static LibraryException invalidCredentials() {
        return new LibraryException(ErrorKind.UNAUTHORIZED, "Invalid email or password");
    }
}
