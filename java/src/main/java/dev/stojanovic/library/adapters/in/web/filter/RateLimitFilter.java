package dev.stojanovic.library.adapters.in.web.filter;

import dev.stojanovic.library.adapters.in.web.support.ProblemCode;
import dev.stojanovic.library.adapters.in.web.support.Problems;
import dev.stojanovic.library.adapters.in.web.support.RequestAttributes;
import dev.stojanovic.library.application.model.RateLimitDecision;
import dev.stojanovic.library.application.service.RateLimitService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Fixed-window rate limiting, keyed by the token subject or else the client IP. Runs before Spring Security so
 * every response, including 401s, carries RateLimit-* headers and floods of bad tokens are throttled as well. The
 * subject is only trusted after the JWT signature has been verified (HS256 verification costs microseconds).
 */
public class RateLimitFilter extends OncePerRequestFilter {

    private final RateLimitService limiter;
    private final JwtDecoder jwtDecoder;
    private final Problems problems;

    public RateLimitFilter(RateLimitService limiter, JwtDecoder jwtDecoder, Problems problems) {
        this.limiter = limiter;
        this.jwtDecoder = jwtDecoder;
        this.problems = problems;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return path.startsWith("/health/") || path.equals("/metrics");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String subject = verifiedSubject(request);
        if (subject != null) {
            request.setAttribute(RequestAttributes.MEMBER_ID, subject);
        }
        RateLimitDecision decision = limiter.check(subject != null ? subject : request.getRemoteAddr());
        response.setHeader("RateLimit-Limit", Long.toString(decision.limit()));
        response.setHeader("RateLimit-Remaining", Long.toString(decision.remaining()));
        response.setHeader("RateLimit-Reset", Long.toString(decision.resetSeconds()));
        if (!decision.allowed()) {
            response.setHeader(HttpHeaders.RETRY_AFTER, Long.toString(decision.resetSeconds()));
            problems.write(request, response, ProblemCode.RATE_LIMITED,
                    "Rate limit of " + decision.limit() + " requests per minute exceeded; retry in "
                            + decision.resetSeconds() + " s");
            return;
        }
        chain.doFilter(request, response);
    }

    private String verifiedSubject(HttpServletRequest request) {
        String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (authorization == null || !authorization.regionMatches(true, 0, "Bearer ", 0, 7)) {
            return null;
        }
        try {
            return jwtDecoder.decode(authorization.substring(7).trim()).getSubject();
        } catch (JwtException e) {
            return null;
        }
    }
}
