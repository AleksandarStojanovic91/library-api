package dev.stojanovic.library.domain.model;

import java.util.List;
import java.util.UUID;

public record BookPatch(Patch<String> title, Patch<String> description, Patch<Integer> publishedYear,
                        Patch<List<UUID>> authorIds, Patch<List<String>> tags) {
}
