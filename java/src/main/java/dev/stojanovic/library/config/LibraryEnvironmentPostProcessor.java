package dev.stojanovic.library.config;

import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * Accepts the SPEC's 12-factor variables as they are written for every implementation:
 * {@code DATABASE_URL=postgres://user:pass@host:5432/db} becomes the JDBC url, username and password, and
 * {@code OTEL_EXPORTER_OTLP_ENDPOINT} switches on OTLP trace export. Explicit {@code spring.*} settings still win.
 */
public class LibraryEnvironmentPostProcessor implements EnvironmentPostProcessor {

    static final String TRACING_ENDPOINT = "management.opentelemetry.tracing.export.otlp.endpoint";

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        Map<String, Object> properties = new HashMap<>();
        String databaseUrl = environment.getProperty("DATABASE_URL");
        if (databaseUrl != null && !databaseUrl.isBlank()) {
            properties.putAll(datasource(databaseUrl));
        }
        String otlp = environment.getProperty("OTEL_EXPORTER_OTLP_ENDPOINT");
        if (otlp != null && !otlp.isBlank() && !environment.containsProperty(TRACING_ENDPOINT)) {
            properties.put(TRACING_ENDPOINT, otlp.replaceAll("/+$", "") + "/v1/traces");
        }
        if (!properties.isEmpty()) {
            // after the OS environment (so SPRING_DATASOURCE_URL etc. still win), before application.yml
            var sources = environment.getPropertySources();
            var source = new MapPropertySource("library-environment", properties);
            if (sources.contains(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME)) {
                sources.addAfter(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME, source);
            } else {
                sources.addFirst(source);
            }
        }
    }

    static Map<String, Object> datasource(String databaseUrl) {
        if (databaseUrl.startsWith("jdbc:")) {
            return Map.of("spring.datasource.url", databaseUrl);
        }
        URI uri = URI.create(databaseUrl);
        if (!"postgres".equals(uri.getScheme()) && !"postgresql".equals(uri.getScheme())) {
            throw new IllegalArgumentException("DATABASE_URL must be a postgres:// URL, got scheme " + uri.getScheme());
        }
        int port = uri.getPort() == -1 ? 5432 : uri.getPort();
        String jdbcUrl = "jdbc:postgresql://" + uri.getHost() + ":" + port + uri.getRawPath()
                + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery());
        Map<String, Object> result = new HashMap<>();
        result.put("spring.datasource.url", jdbcUrl);
        String userInfo = uri.getRawUserInfo();
        if (userInfo != null) {
            String[] parts = userInfo.split(":", 2);
            result.put("spring.datasource.username", URLDecoder.decode(parts[0], StandardCharsets.UTF_8));
            if (parts.length == 2) {
                result.put("spring.datasource.password", URLDecoder.decode(parts[1], StandardCharsets.UTF_8));
            }
        }
        return result;
    }
}
