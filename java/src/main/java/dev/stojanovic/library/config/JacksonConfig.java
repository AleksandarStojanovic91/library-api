package dev.stojanovic.library.config;

import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.core.JsonGenerator;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.SerializationContext;
import tools.jackson.databind.module.SimpleModule;
import tools.jackson.databind.ser.std.StdSerializer;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

@Configuration(proxyBeanMethods = false)
class JacksonConfig {

    /** {@code 2026-10-13T09:15:00.000Z}: always UTC, always exactly three fractional digits (SPEC, Time). */
    static final DateTimeFormatter TIMESTAMP =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    @Bean
    JsonMapperBuilderCustomizer libraryJson() {
        SimpleModule timestamps = new SimpleModule("library-timestamps");
        timestamps.addSerializer(Instant.class, new StdSerializer<>(Instant.class) {
            @Override
            public void serialize(Instant value, JsonGenerator generator, SerializationContext context) {
                generator.writeString(TIMESTAMP.format(value));
            }
        });
        return builder -> builder
                .addModule(timestamps)
                // the contract's request schemas are closed (additionalProperties: false)
                .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
                .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                // "1999" is not an integer and 2.5 is not 2: the contract's types are taken literally
                .disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
                .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT);
    }
}
