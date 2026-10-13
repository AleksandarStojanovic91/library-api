package dev.stojanovic.library.adapters.in.web.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record CopyCreateRequest(@NotNull @Pattern(regexp = "^[A-Z0-9-]{4,32}$") String barcode) {
}
