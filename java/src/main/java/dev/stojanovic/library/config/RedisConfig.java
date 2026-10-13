package dev.stojanovic.library.config;

import io.lettuce.core.ClientOptions;
import io.lettuce.core.SocketOptions;
import org.springframework.boot.data.redis.autoconfigure.LettuceClientConfigurationBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

@Configuration(proxyBeanMethods = false)
class RedisConfig {

    /**
     * Fail fast instead of queueing commands while disconnected: Redis is an optimisation, and a request should
     * fall back to the database rather than wait for a reconnect.
     */
    @Bean
    LettuceClientConfigurationBuilderCustomizer failFastRedis() {
        return builder -> builder.clientOptions(ClientOptions.builder()
                .disconnectedBehavior(ClientOptions.DisconnectedBehavior.REJECT_COMMANDS)
                .socketOptions(SocketOptions.builder().connectTimeout(Duration.ofMillis(300)).build())
                .build());
    }
}
