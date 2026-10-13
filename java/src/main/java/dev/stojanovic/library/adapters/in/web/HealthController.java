package dev.stojanovic.library.adapters.in.web;

import dev.stojanovic.library.adapters.in.web.dto.HealthResponse;
import dev.stojanovic.library.application.model.HealthReport;
import dev.stojanovic.library.application.service.HealthService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
class HealthController {

    private final HealthService health;

    HealthController(HealthService health) {
        this.health = health;
    }

    /** Liveness: the process answers. Never checks dependencies, or a DB blip would get every pod restarted. */
    @GetMapping("/health/live")
    HealthResponse live() {
        return new HealthResponse("UP", null);
    }

    @GetMapping("/health/ready")
    ResponseEntity<HealthResponse> ready() {
        HealthReport report = health.readiness();
        Map<String, String> checks = new LinkedHashMap<>();
        report.checks().forEach((name, up) -> checks.put(name, up ? "UP" : "DOWN"));
        return ResponseEntity.status(report.ready() ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
                .body(new HealthResponse(report.ready() ? "UP" : "DOWN", checks));
    }
}
