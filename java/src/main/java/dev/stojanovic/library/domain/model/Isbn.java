package dev.stojanovic.library.domain.model;

import java.util.regex.Pattern;

/** ISBN-13 rules: 978/979 prefix, 13 digits and a valid check digit (weights 1,3,1,3,...). */
public final class Isbn {

    private static final Pattern FORMAT = Pattern.compile("^97[89][0-9]{10}$");

    private Isbn() {
    }

    public static boolean isValid(String candidate) {
        if (candidate == null || !FORMAT.matcher(candidate).matches()) {
            return false;
        }
        return checkDigit(candidate.substring(0, 12)) == candidate.charAt(12) - '0';
    }

    /** Check digit for the first 12 digits of an ISBN-13. */
    public static int checkDigit(String first12Digits) {
        if (first12Digits.length() != 12) {
            throw new IllegalArgumentException("Expected 12 digits");
        }
        int sum = 0;
        for (int i = 0; i < 12; i++) {
            int digit = first12Digits.charAt(i) - '0';
            sum += (i % 2 == 0) ? digit : digit * 3;
        }
        return (10 - sum % 10) % 10;
    }
}
