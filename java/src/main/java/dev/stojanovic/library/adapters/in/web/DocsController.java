package dev.stojanovic.library.adapters.in.web;

import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Serves the shared contract (copied onto the classpath at build time) and a Swagger UI page that renders it. */
@RestController
class DocsController {

    private static final MediaType YAML = MediaType.parseMediaType("application/yaml");

    @GetMapping("/openapi.yaml")
    ResponseEntity<Resource> contract() {
        return ResponseEntity.ok().contentType(YAML).body(new ClassPathResource("contract/openapi.yaml"));
    }

    @GetMapping("/docs")
    ResponseEntity<Resource> swaggerUi() {
        return ResponseEntity.ok().contentType(MediaType.TEXT_HTML).body(new ClassPathResource("docs/index.html"));
    }
}
