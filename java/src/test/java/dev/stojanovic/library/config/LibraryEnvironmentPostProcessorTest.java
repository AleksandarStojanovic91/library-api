package dev.stojanovic.library.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class LibraryEnvironmentPostProcessorTest {

    @Test
    void translatesThePostgresUrlFromTheSpec() {
        assertThat(LibraryEnvironmentPostProcessor.datasource("postgres://library:library@postgres:5432/library_java"))
                .containsExactlyInAnyOrderEntriesOf(Map.of(
                        "spring.datasource.url", "jdbc:postgresql://postgres:5432/library_java",
                        "spring.datasource.username", "library",
                        "spring.datasource.password", "library"));
    }

    @Test
    void keepsQueryParametersDefaultsThePortAndDecodesCredentials() {
        assertThat(LibraryEnvironmentPostProcessor.datasource("postgresql://app:p%40ss@db/lib?sslmode=require"))
                .containsEntry("spring.datasource.url", "jdbc:postgresql://db:5432/lib?sslmode=require")
                .containsEntry("spring.datasource.password", "p@ss");
    }

    @Test
    void passesJdbcUrlsThrough() {
        assertThat(LibraryEnvironmentPostProcessor.datasource("jdbc:postgresql://h:1/d"))
                .containsExactlyEntriesOf(Map.of("spring.datasource.url", "jdbc:postgresql://h:1/d"));
    }

    @Test
    void rejectsOtherDatabases() {
        assertThatThrownBy(() -> LibraryEnvironmentPostProcessor.datasource("mysql://u:p@h/d"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void mapsEnvironmentAndOtlpEndpoint() {
        MockEnvironment environment = new MockEnvironment()
                .withProperty("DATABASE_URL", "postgres://u:p@h:5433/d")
                .withProperty("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318/");
        new LibraryEnvironmentPostProcessor().postProcessEnvironment(environment, null);
        assertThat(environment.getProperty("spring.datasource.url")).isEqualTo("jdbc:postgresql://h:5433/d");
        assertThat(environment.getProperty(LibraryEnvironmentPostProcessor.TRACING_ENDPOINT))
                .isEqualTo("http://collector:4318/v1/traces");
    }
}
