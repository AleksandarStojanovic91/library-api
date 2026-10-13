package dev.stojanovic.library.it.support;

import org.springframework.test.context.DynamicPropertyRegistry;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * PostgreSQL 16 and Redis 7 for the integration tests, started once per JVM (Testcontainers' singleton pattern;
 * Ryuk removes them afterwards). Set {@code IT_DATABASE_URL} (JDBC), {@code IT_DATABASE_USER},
 * {@code IT_DATABASE_PASSWORD} and {@code IT_REDIS_URL} to run against existing services instead, e.g. CI service
 * containers. The tests create their own data, so a shared or reused database is fine.
 * Redis is passed as {@code REDIS_URL} (the variable application.yml reads), so a test class can still point
 * {@code spring.data.redis.url} elsewhere with {@code @TestPropertySource}.
 */
public final class Infrastructure {

    private static final String EXTERNAL_DB = System.getenv("IT_DATABASE_URL");

    private static PostgreSQLContainer postgres;
    private static GenericContainer<?> redis;

    private Infrastructure() {
    }

    public static synchronized void register(DynamicPropertyRegistry registry) {
        if (EXTERNAL_DB != null) {
            registry.add("spring.datasource.url", () -> EXTERNAL_DB);
            registry.add("spring.datasource.username", () -> env("IT_DATABASE_USER", "library"));
            registry.add("spring.datasource.password", () -> env("IT_DATABASE_PASSWORD", "library"));
            registry.add("REDIS_URL", () -> env("IT_REDIS_URL", "redis://localhost:6379/0"));
            return;
        }
        if (postgres == null) {
            postgres = new PostgreSQLContainer("postgres:16-alpine")
                    .withDatabaseName("library_java").withUsername("library").withPassword("library");
            redis = new GenericContainer<>("redis:7-alpine").withExposedPorts(6379);
            postgres.start();
            redis.start();
        }
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("REDIS_URL",
                () -> "redis://" + redis.getHost() + ":" + redis.getMappedPort(6379) + "/0");
    }

    private static String env(String name, String fallback) {
        String value = System.getenv(name);
        return value == null ? fallback : value;
    }
}
