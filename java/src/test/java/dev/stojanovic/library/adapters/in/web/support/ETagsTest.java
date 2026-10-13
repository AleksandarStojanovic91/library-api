package dev.stojanovic.library.adapters.in.web.support;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ETagsTest {

    @Test
    void formatsQuotedVersion() {
        assertThat(ETags.of(3)).isEqualTo("\"3\"");
    }

    @Test
    void ifNoneMatchUsesWeakComparison() {
        assertThat(ETags.noneMatchHits("\"3\"", 3)).isTrue();
        assertThat(ETags.noneMatchHits("W/\"3\"", 3)).isTrue();
        assertThat(ETags.noneMatchHits("\"1\", \"3\"", 3)).isTrue();
        assertThat(ETags.noneMatchHits("*", 3)).isTrue();
        assertThat(ETags.noneMatchHits("\"2\"", 3)).isFalse();
        assertThat(ETags.noneMatchHits("3", 3)).isFalse();
        assertThat(ETags.noneMatchHits(null, 3)).isFalse();
    }

    @Test
    void ifMatchUsesStrongComparison() {
        assertThat(ETags.ifMatch("\"3\"").test(3)).isTrue();
        assertThat(ETags.ifMatch("\"2\", \"3\"").test(3)).isTrue();
        assertThat(ETags.ifMatch("*").test(42)).isTrue();
        assertThat(ETags.ifMatch("W/\"3\"").test(3)).isFalse();
        assertThat(ETags.ifMatch("\"4\"").test(3)).isFalse();
    }
}
