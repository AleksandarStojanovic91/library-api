package dev.stojanovic.library.adapters.in.web.filter;

import dev.stojanovic.library.adapters.in.web.support.RequestAttributes;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.HandlerMapping;

import java.io.IOException;

/**
 * One structured line per request. The path is the route template ({@code /api/v2/loans/{loanId}}), so ids do not
 * end up in log aggregations; requests that never reached a controller (401, 404, 429) log the raw path.
 * {@code requestId} comes from the MDC (set by {@link RequestIdFilter}), so every other log line has it too.
 */
public class AccessLogFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger("http.access");

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        long start = System.nanoTime();
        try {
            chain.doFilter(request, response);
        } finally {
            Object route = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
            log.atInfo()
                    .addKeyValue("method", request.getMethod())
                    .addKeyValue("path", route != null ? route : request.getRequestURI())
                    .addKeyValue("status", response.getStatus())
                    .addKeyValue("durationMs", (System.nanoTime() - start) / 1_000_000.0)
                    .addKeyValue("memberId", RequestAttributes.memberId(request))
                    .log("request");
        }
    }
}
