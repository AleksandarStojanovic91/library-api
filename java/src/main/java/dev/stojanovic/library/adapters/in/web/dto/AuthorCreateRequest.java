package dev.stojanovic.library.adapters.in.web.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record AuthorCreateRequest(@NotNull @Size(min = 1, max = 200) String name, @Size(max = 2000) String bio) {
}
