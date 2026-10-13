package dev.stojanovic.library.adapters.out.persistence;

import dev.stojanovic.library.application.port.out.HealthProbe;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
@Order(1)
class DatabaseHealthProbe implements HealthProbe {

    private static final Logger log = LoggerFactory.getLogger(DatabaseHealthProbe.class);

    private final JdbcClient jdbc;

    DatabaseHealthProbe(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public String name() {
        return "db";
    }

    @Override
    public boolean optional() {
        return false;
    }

    @Override
    public boolean isUp() {
        try {
            return jdbc.sql("SELECT 1").query(Integer.class).single() == 1;
        } catch (RuntimeException e) {
            log.warn("Database health check failed: {}", e.getMessage());
            return false;
        }
    }
}
