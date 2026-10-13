package dev.stojanovic.library.adapters.in.web.validation;

import dev.stojanovic.library.domain.model.Isbn;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public class Isbn13Validator implements ConstraintValidator<Isbn13, String> {

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        return value == null || Isbn.isValid(value);
    }
}
