package dev.stojanovic.library.config;

import dev.stojanovic.library.adapters.in.web.security.ProblemAccessDeniedHandler;
import dev.stojanovic.library.adapters.in.web.security.ProblemAuthenticationEntryPoint;
import dev.stojanovic.library.adapters.in.web.support.Problems;
import jakarta.servlet.DispatcherType;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.web.SecurityFilterChain;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Set;

/**
 * Stateless JWT resource server (HS256). Role checks for librarian-only routes live here; ownership rules
 * ("404, not 403, for someone else's loan") live in the application services, where they can be unit-tested.
 */
@Configuration(proxyBeanMethods = false)
class SecurityConfig {

    static final String ISSUER = "library-api";
    private static final String LIBRARIAN = "LIBRARIAN";

    @Bean
    SecurityFilterChain api(HttpSecurity http, Problems problems, JwtDecoder decoder) throws Exception {
        var entryPoint = new ProblemAuthenticationEntryPoint(problems);
        var accessDenied = new ProblemAccessDeniedHandler(problems);
        http
                .csrf(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .requestCache(AbstractHttpConfigurer::disable)
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                // Every protected route is listed explicitly and everything else is public, so an unknown route is a
                // 404 rather than a 401. SecurityRoutesIT walks the contract to prove no operation is left open.
                .authorizeHttpRequests(auth -> auth
                        .dispatcherTypeMatchers(DispatcherType.ERROR, DispatcherType.FORWARD).permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/books", "/api/v1/books/*/copies").hasRole(LIBRARIAN)
                        .requestMatchers(HttpMethod.PATCH, "/api/v1/books/*").hasRole(LIBRARIAN)
                        .requestMatchers(HttpMethod.DELETE, "/api/v1/books/*").hasRole(LIBRARIAN)
                        .requestMatchers(HttpMethod.POST, "/api/v1/authors").hasRole(LIBRARIAN)
                        .requestMatchers(HttpMethod.GET, "/api/v1/members").hasRole(LIBRARIAN)
                        .requestMatchers(HttpMethod.POST, "/api/v1/members").hasRole(LIBRARIAN)
                        .requestMatchers(HttpMethod.PUT, "/api/v1/members/*/status").hasRole(LIBRARIAN)
                        .requestMatchers("/api/v1/members/**").authenticated()
                        .requestMatchers("/api/v1/loans", "/api/v1/loans/**").authenticated()
                        .requestMatchers("/api/v2/loans", "/api/v2/loans/**").authenticated()
                        .requestMatchers("/api/v1/reservations", "/api/v1/reservations/**").authenticated()
                        .anyRequest().permitAll())
                .oauth2ResourceServer(oauth -> oauth
                        .jwt(jwt -> jwt.decoder(decoder).jwtAuthenticationConverter(roleFromClaim()))
                        .authenticationEntryPoint(entryPoint)
                        .accessDeniedHandler(accessDenied))
                .exceptionHandling(e -> e.authenticationEntryPoint(entryPoint).accessDeniedHandler(accessDenied));
        return http.build();
    }

    @Bean
    JwtDecoder jwtDecoder(LibraryProperties properties) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(secretKey(properties))
                .macAlgorithm(MacAlgorithm.HS256)
                .build();
        OAuth2TokenValidator<Jwt> role = new JwtClaimValidator<String>("role", Set.of("MEMBER", LIBRARIAN)::contains);
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(JwtValidators.createDefaultWithIssuer(ISSUER), role));
        return decoder;
    }

    @Bean
    JwtEncoder jwtEncoder(LibraryProperties properties) {
        return NimbusJwtEncoder.withSecretKey(secretKey(properties)).algorithm(MacAlgorithm.HS256).build();
    }

    private static SecretKey secretKey(LibraryProperties properties) {
        return new SecretKeySpec(properties.jwtSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    }

    /** {@code role: LIBRARIAN} becomes authority {@code ROLE_LIBRARIAN}; the principal name is {@code sub}. */
    private static JwtAuthenticationConverter roleFromClaim() {
        JwtGrantedAuthoritiesConverter authorities = new JwtGrantedAuthoritiesConverter();
        authorities.setAuthoritiesClaimName("role");
        authorities.setAuthorityPrefix("ROLE_");
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(authorities);
        return converter;
    }
}
