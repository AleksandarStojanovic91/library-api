package dev.stojanovic.library.config;

import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** The background worker runs unless WORKER_ENABLED=false (integration tests drive it by hand). */
@Configuration(proxyBeanMethods = false)
@EnableScheduling
@ConditionalOnBooleanProperty(name = "library.worker.enabled", matchIfMissing = true)
class SchedulingConfig {
}
