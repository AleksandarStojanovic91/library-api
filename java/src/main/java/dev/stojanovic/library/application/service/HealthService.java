package dev.stojanovic.library.application.service;

import dev.stojanovic.library.application.model.HealthReport;
import dev.stojanovic.library.application.port.out.HealthProbe;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class HealthService {

    private final List<HealthProbe> probes;

    public HealthService(List<HealthProbe> probes) {
        this.probes = probes;
    }

    /** Ready unless a required dependency is down; optional ones (the cache) only show up as DOWN. */
    public HealthReport readiness() {
        Map<String, Boolean> checks = new LinkedHashMap<>();
        boolean ready = true;
        for (HealthProbe probe : probes) {
            boolean up = probe.isUp();
            checks.put(probe.name(), up);
            ready &= up || probe.optional();
        }
        return new HealthReport(ready, checks);
    }
}
