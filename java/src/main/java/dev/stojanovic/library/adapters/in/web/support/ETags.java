package dev.stojanovic.library.adapters.in.web.support;

import java.util.Arrays;
import java.util.function.IntPredicate;

/** Version-based entity tags: {@code "<version>"}. */
public final class ETags {

    private ETags() {
    }

    public static String of(int version) {
        return "\"" + version + "\"";
    }

    /** If-None-Match uses the weak comparison (RFC 9110 13.1.2), so {@code W/"3"} matches version 3. */
    public static boolean noneMatchHits(String ifNoneMatch, int version) {
        if (ifNoneMatch == null) {
            return false;
        }
        return Arrays.stream(ifNoneMatch.split(",")).map(String::trim).anyMatch(tag ->
                tag.equals("*") || stripWeak(tag).equals(of(version)));
    }

    /** If-Match uses the strong comparison (RFC 9110 13.1.1): weak tags never match. */
    public static IntPredicate ifMatch(String ifMatch) {
        String[] tags = Arrays.stream(ifMatch.split(",")).map(String::trim).toArray(String[]::new);
        return version -> Arrays.stream(tags).anyMatch(tag -> tag.equals("*") || tag.equals(of(version)));
    }

    private static String stripWeak(String tag) {
        return tag.startsWith("W/") ? tag.substring(2) : tag;
    }
}
