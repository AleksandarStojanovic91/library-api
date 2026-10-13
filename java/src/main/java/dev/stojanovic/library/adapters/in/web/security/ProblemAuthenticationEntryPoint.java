package dev.stojanovic.library.adapters.in.web.security;

import dev.stojanovic.library.adapters.in.web.support.ProblemCode;
import dev.stojanovic.library.adapters.in.web.support.Problems;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.server.resource.InvalidBearerTokenException;
import org.springframework.security.web.AuthenticationEntryPoint;

import java.io.IOException;

/** 401 as a problem document, with the {@code WWW-Authenticate: Bearer} challenge (RFC 6750). */
public class ProblemAuthenticationEntryPoint implements AuthenticationEntryPoint {

    private final Problems problems;

    public ProblemAuthenticationEntryPoint(Problems problems) {
        this.problems = problems;
    }

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response,
                         AuthenticationException exception) throws IOException {
        boolean badToken = exception instanceof InvalidBearerTokenException;
        response.setHeader(HttpHeaders.WWW_AUTHENTICATE,
                badToken ? "Bearer error=\"invalid_token\"" : "Bearer");
        problems.write(request, response, ProblemCode.UNAUTHORIZED,
                badToken ? "The bearer token is invalid or expired" : "A bearer token is required");
    }
}
