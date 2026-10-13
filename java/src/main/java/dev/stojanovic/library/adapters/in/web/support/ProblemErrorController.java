package dev.stojanovic.library.adapters.in.web.support;

import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.webmvc.error.ErrorController;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Replaces Spring Boot's default /error page so errors raised outside Spring MVC (by the servlet container or a
 * filter) are problem documents too.
 */
@RestController
public class ProblemErrorController implements ErrorController {

    private final Problems problems;

    public ProblemErrorController(Problems problems) {
        this.problems = problems;
    }

    @RequestMapping("${server.error.path:/error}")
    ResponseEntity<ProblemBody> error(HttpServletRequest request) {
        Object status = request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE);
        ProblemCode problem = ProblemCode.forStatus(status instanceof Integer i ? i : 500);
        int code = problem.status().value(); // every code is pinned to one status
        ProblemBody body = problems.body(problem, problem == ProblemCode.INTERNAL
                ? "An unexpected error occurred; quote the requestId when reporting it" : null, null, request);
        return ResponseEntity.status(code)
                .headers(h -> {
                    if (code == 401) {
                        h.set(org.springframework.http.HttpHeaders.WWW_AUTHENTICATE, "Bearer");
                    }
                })
                .contentType(org.springframework.http.MediaType.APPLICATION_PROBLEM_JSON)
                .body(new ProblemBody(body.type(), body.title(), code, body.detail(), body.instance(), body.code(),
                        null, body.requestId()));
    }
}
