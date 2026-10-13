package dev.stojanovic.library.adapters.out.security;

import dev.stojanovic.library.application.model.IssuedToken;
import dev.stojanovic.library.application.model.MemberCredentials;
import dev.stojanovic.library.application.port.out.TokenIssuer;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;

@Component
class JwtTokenIssuer implements TokenIssuer {

    public static final String ISSUER = "library-api";
    static final Duration LIFETIME = Duration.ofHours(1);

    private final JwtEncoder encoder;

    JwtTokenIssuer(JwtEncoder encoder) {
        this.encoder = encoder;
    }

    /** Uses real time, not the business clock: token validity must not move with CLOCK_OFFSET_SECONDS. */
    @Override
    public IssuedToken issue(MemberCredentials member) {
        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(ISSUER)
                .subject(member.id().toString())
                .claim("role", member.role().name())
                .claim("email", member.email())
                .issuedAt(now)
                .expiresAt(now.plus(LIFETIME))
                .build();
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).type("JWT").build();
        String token = encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
        return new IssuedToken(token, LIFETIME.toSeconds());
    }
}
