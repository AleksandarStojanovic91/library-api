package dev.stojanovic.library.adapters.in.web.filter;

import dev.stojanovic.library.adapters.in.web.support.RequestAttributes;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;

/** Echoes a well-formed client X-Request-Id or generates one; it goes into every response, log line and problem. */
public class RequestIdFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Request-Id";
    private static final Pattern VALID = Pattern.compile("^[A-Za-z0-9_-]{8,100}$");

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String requestId = request.getHeader(HEADER);
        if (requestId == null || !VALID.matcher(requestId).matches()) {
            requestId = UUID.randomUUID().toString();
        }
        request.setAttribute(RequestAttributes.REQUEST_ID, requestId);
        response.setHeader(HEADER, requestId);
        MDC.put("requestId", requestId);
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.remove("requestId");
        }
    }
}
