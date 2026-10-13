package dev.stojanovic.library.domain;

import dev.stojanovic.library.domain.policy.FeeCalculator;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FeeCalculatorTest {

    private static final Instant DUE = Instant.parse("2026-10-27T12:00:00Z");
    private final FeeCalculator fees = new FeeCalculator(50);

    @ParameterizedTest(name = "{0} late -> {1} cents")
    @CsvSource({
            "PT0S, 0",       // exactly on time
            "-PT5H, 0",      // early
            "PT0.001S, 50",  // any started day counts
            "PT1S, 50",
            "PT23H59M59S, 50",
            "PT24H, 50",     // exactly one day
            "PT24H0.001S, 100",
            "P2D, 100",
            "P2DT1S, 150",
            "P10D, 500"})
    void chargesEveryStartedDay(Duration late, long expectedCents) {
        assertThat(fees.feeCents(DUE, DUE.plus(late))).isEqualTo(expectedCents);
    }

    @Test
    void zeroRateMeansNoFees() {
        assertThat(new FeeCalculator(0).feeCents(DUE, DUE.plus(Duration.ofDays(30)))).isZero();
    }

    @Test
    void negativeRateIsRejected() {
        assertThatThrownBy(() -> new FeeCalculator(-1)).isInstanceOf(IllegalArgumentException.class);
    }
}
