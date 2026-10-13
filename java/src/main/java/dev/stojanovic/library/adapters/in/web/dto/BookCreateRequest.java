package dev.stojanovic.library.adapters.in.web.dto;

import dev.stojanovic.library.adapters.in.web.validation.Isbn13;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.hibernate.validator.constraints.UniqueElements;

import java.util.List;
import java.util.UUID;

public record BookCreateRequest(
        @NotNull @Isbn13 String isbn,
        @NotNull @Size(min = 1, max = 300) String title,
        @Size(max = 5000) String description,
        @Min(1450) @Max(2100) Integer publishedYear,
        @NotNull @Size(min = 1, max = 20) @UniqueElements List<@NotNull @Pattern(regexp = UUID_PATTERN,
                message = "must be a UUID") String> authorIds,
        @Size(max = 20) @UniqueElements List<@NotNull @Size(min = 1, max = 50) String> tags) {

    /** Ids are bound as strings: a typed UUID list would fail JSON binding on the first bad id and hide the rest. */
    public static final String UUID_PATTERN =
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

    public List<UUID> authorUuids() {
        return authorIds.stream().map(UUID::fromString).toList();
    }
}
