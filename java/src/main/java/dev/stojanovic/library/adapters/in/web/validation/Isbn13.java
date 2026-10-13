package dev.stojanovic.library.adapters.in.web.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** 13 digits starting with 978/979 and a valid check digit. {@code null} is valid (use @NotNull). */
@Documented
@Constraint(validatedBy = Isbn13Validator.class)
@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT, ElementType.TYPE_USE})
@Retention(RetentionPolicy.RUNTIME)
public @interface Isbn13 {

    String message() default "must be a valid ISBN-13 (978/979 prefix and correct check digit)";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
