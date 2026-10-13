import { Inject, Injectable } from '@nestjs/common';
import type { Author } from '../../domain/catalog/catalog';
import { DomainError } from '../../domain/shared/domain-error';
import type { Page } from '../../domain/shared/page';
import type { AuthorRepository } from '../ports/repositories';
import { TOKENS } from '../ports/tokens';
import { decodeCreatedKey, encodeCreatedKey, toPage, type PageRequest } from '../shared/pagination';

@Injectable()
export class AuthorDirectory {
  constructor(@Inject(TOKENS.AuthorRepository) private readonly authors: AuthorRepository) {}

  async list(page: PageRequest): Promise<Page<Author>> {
    const rows = await this.authors.findPage(decodeCreatedKey(page.cursor), page.limit + 1);
    return toPage(rows, page.limit, encodeCreatedKey);
  }

  async get(id: string): Promise<Author> {
    const author = await this.authors.findById(id);
    if (!author) {
      throw DomainError.notFound('Author');
    }
    return author;
  }

  create(input: { name: string; bio: string | null }): Promise<Author> {
    return this.authors.insert(input);
  }
}
