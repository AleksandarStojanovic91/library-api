package dev.stojanovic.library.application.model;

import java.util.List;
import java.util.UUID;

public record NewBook(String isbn, String title, String description, Integer publishedYear, List<UUID> authorIds,
                      List<String> tags) {
}
