import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { DomainError, type FieldError } from '../../../domain/shared/domain-error';

/**
 * Field names use JSON-pointer style without the leading slash (`authorIds.0`), as SPEC.md requires, and
 * every failing field is reported, not just the first one.
 */
export function fieldErrorsOf(error: z.ZodError, root: string): FieldError[] {
  return error.issues.flatMap((issue): FieldError[] => {
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({ field: [...issue.path, key].map(String).join('.'), message: 'Unknown property' }));
    }
    return [{ field: issue.path.map(String).join('.') || root, message: issue.message }];
  });
}

export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(
    private readonly schema: S,
    /** Field name reported when the whole value is wrong (e.g. no body at all). */
    private readonly root: string = 'body',
  ) {}

  transform(value: unknown): z.output<S> {
    // Every request body in the contract is an object. A body that is valid JSON but not an object (a string,
    // an array, a number) cannot be read as one, which is how a Jackson-based service reports it too.
    if (this.root === 'body' && value !== undefined && (typeof value !== 'object' || value === null || Array.isArray(value))) {
      throw new DomainError('validation-failed', 'Malformed JSON body', [{ field: 'body', message: 'Expected a JSON object' }]);
    }
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw DomainError.validation(fieldErrorsOf(result.error, this.root));
    }
    return result.data;
  }
}
