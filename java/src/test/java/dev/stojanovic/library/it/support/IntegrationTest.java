package dev.stojanovic.library.it.support;

import dev.stojanovic.library.adapters.in.scheduling.BackgroundWorker;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.json.JsonMapper;

/**
 * Base for integration tests: the whole application on a random port, real PostgreSQL and Redis, a controllable
 * clock, and the background worker switched off so tests can run its steps deterministically.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestClockConfig.class)
public abstract class IntegrationTest {

    private static final Contract CONTRACT = new Contract();

    @DynamicPropertySource
    static void infrastructure(DynamicPropertyRegistry registry) {
        Infrastructure.register(registry);
        // via the SPEC variables, so a test class can override library.* with @TestPropertySource
        registry.add("WORKER_ENABLED", () -> "false");
        registry.add("RATE_LIMIT_PER_MINUTE", () -> "1000000");
    }

    @LocalServerPort
    protected int port;
    @Autowired
    protected MutableClock clock;
    @Autowired
    protected JdbcClient jdbc;
    @Autowired
    protected BackgroundWorker worker;
    @Autowired
    protected JsonMapper json;

    protected Api api;
    protected Fixtures data;

    @BeforeEach
    void setUpClient() {
        clock.reset();
        api = new Api(port, json, CONTRACT);
        data = new Fixtures(api);
    }

    protected Contract contract() {
        return CONTRACT;
    }
}
