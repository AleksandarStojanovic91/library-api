package dev.stojanovic.library.application.model;

public record NewMember(String email, String name, String password, int maxActiveLoans) {

    public static final int DEFAULT_MAX_ACTIVE_LOANS = 3;
}
