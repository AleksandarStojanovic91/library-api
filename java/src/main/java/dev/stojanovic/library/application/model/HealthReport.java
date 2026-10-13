package dev.stojanovic.library.application.model;

import java.util.Map;

/** {@code ready} is false only when a critical dependency (the database) is down. */
public record HealthReport(boolean ready, Map<String, Boolean> checks) {

    public HealthReport {
        checks = Map.copyOf(checks);
    }
}
