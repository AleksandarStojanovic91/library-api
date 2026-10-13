package dev.stojanovic.library.config;

import dev.stojanovic.library.application.port.out.RateCounter;
import dev.stojanovic.library.application.service.RateLimitService;
import dev.stojanovic.library.domain.policy.FeeCalculator;
import dev.stojanovic.library.domain.policy.LoanPolicy;
import dev.stojanovic.library.domain.policy.ReservationPolicy;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;
import java.time.Duration;

/** Wires the framework-free domain policies and the business clock. */
@Configuration(proxyBeanMethods = false)
class CoreConfig {

    /**
     * Business "now": UTC, millisecond precision (what the API prints, so stored and returned values agree), shifted
     * by CLOCK_OFFSET_SECONDS for time-travel tests. JWT timestamps deliberately do not use it.
     */
    @Bean
    Clock clock(LibraryProperties properties) {
        return Clock.offset(Clock.tickMillis(java.time.ZoneOffset.UTC),
                Duration.ofSeconds(properties.clockOffsetSeconds()));
    }

    @Bean
    LoanPolicy loanPolicy(LibraryProperties properties) {
        return new LoanPolicy(Duration.ofDays(properties.loanDays()), new FeeCalculator(properties.feeCentsPerDay()));
    }

    @Bean
    ReservationPolicy reservationPolicy(LibraryProperties properties) {
        return new ReservationPolicy(Duration.ofHours(properties.reservationHoldHours()));
    }

    @Bean
    RateLimitService rateLimitService(RateCounter counter, Clock clock, LibraryProperties properties) {
        return new RateLimitService(counter, clock, properties.rateLimitNamespace(), properties.rateLimitPerMinute());
    }
}
