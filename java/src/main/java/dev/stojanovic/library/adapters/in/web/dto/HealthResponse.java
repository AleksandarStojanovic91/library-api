package dev.stojanovic.library.adapters.in.web.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record HealthResponse(String status, Map<String, String> checks) {
}
