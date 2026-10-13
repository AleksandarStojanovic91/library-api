package dev.stojanovic.library.adapters.in.web.security;

import dev.stojanovic.library.adapters.in.web.support.ProblemCode;
import dev.stojanovic.library.adapters.in.web.support.Problems;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.web.access.AccessDeniedHandler;

import java.io.IOException;

public class ProblemAccessDeniedHandler implements AccessDeniedHandler {

    private final Problems problems;

    public ProblemAccessDeniedHandler(Problems problems) {
        this.problems = problems;
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response, AccessDeniedException exception)
            throws IOException {
        problems.write(request, response, ProblemCode.FORBIDDEN, "This operation is reserved for librarians");
    }
}
