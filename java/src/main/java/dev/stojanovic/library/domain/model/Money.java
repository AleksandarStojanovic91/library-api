package dev.stojanovic.library.domain.model;

import java.math.BigDecimal;

/** An amount in minor units; the library only charges EUR. */
public record Money(long cents, String currency) {

    public static final String EUR = "EUR";

    public Money {
        if (cents < 0) {
            throw new IllegalArgumentException("Money cannot be negative");
        }
    }

    public static Money eurCents(long cents) {
        return new Money(cents, EUR);
    }

    /** Decimal string with exactly two places, e.g. 150 -> "1.50". */
    public String amount() {
        return BigDecimal.valueOf(cents, 2).toPlainString();
    }
}
