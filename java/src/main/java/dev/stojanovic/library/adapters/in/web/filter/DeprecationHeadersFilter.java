package dev.stojanovic.library.adapters.in.web.filter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Marks every /api/v1/loans* response, errors included, as deprecated (RFC 9745 Deprecation, RFC 8594 Sunset and a
 * successor-version link). A filter rather than controller code so 401/404/429 responses carry the headers too.
 */
public class DeprecationHeadersFilter extends OncePerRequestFilter {

    static final String DEPRECATION = "@1767225600";
    static final String SUNSET = "Thu, 31 Dec 2026 23:59:59 GMT";
    static final String LINK = "</api/v2/loans>; rel=\"successor-version\"";

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return !(path.equals("/api/v1/loans") || path.startsWith("/api/v1/loans/"));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        response.setHeader("Deprecation", DEPRECATION);
        response.setHeader("Sunset", SUNSET);
        response.setHeader("Link", LINK);
        chain.doFilter(request, response);
    }
}
