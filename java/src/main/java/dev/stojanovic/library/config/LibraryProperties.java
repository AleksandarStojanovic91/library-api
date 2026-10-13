package dev.stojanovic.library.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/** Settings from SPEC.md; application.yml maps the documented environment variables onto them. */
@Validated
@ConfigurationProperties("library")
public record LibraryProperties(
        @NotNull @Size(min = 32, message = "must be at least 32 bytes for HS256") String jwtSecret,
        @Min(1) int rateLimitPerMinute,
        @NotBlank String rateLimitNamespace,
        @Min(1) int loanDays,
        @Min(0) int feeCentsPerDay,
        @Min(1) int reservationHoldHours,
        long clockOffsetSeconds,
        @Valid @NotNull Worker worker) {

    public record Worker(boolean enabled, @Min(100) long intervalMs) {
    }
}
