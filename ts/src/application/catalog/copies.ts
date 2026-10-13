import { Inject, Injectable } from '@nestjs/common';
import type { Copy } from '../../domain/catalog/catalog';
import { DomainError } from '../../domain/shared/domain-error';
import type { BookRepository, CopyRepository } from '../ports/repositories';
import type { BookCache } from '../ports/services';
import { TOKENS } from '../ports/tokens';
import type { TransactionManager } from '../ports/transaction-manager';

@Injectable()
export class CopyCatalog {
  constructor(
    @Inject(TOKENS.TransactionManager) private readonly tx: TransactionManager,
    @Inject(TOKENS.BookRepository) private readonly books: BookRepository,
    @Inject(TOKENS.CopyRepository) private readonly copies: CopyRepository,
    @Inject(TOKENS.BookCache) private readonly cache: BookCache,
  ) {}

  async list(bookId: string): Promise<Copy[]> {
    if (!(await this.books.exists(bookId))) {
      throw DomainError.notFound('Book');
    }
    return this.copies.listByBook(bookId);
  }

  async add(bookId: string, barcode: string): Promise<Copy> {
    return this.tx.run(async () => {
      if (!(await this.books.exists(bookId))) {
        throw DomainError.notFound('Book');
      }
      const copy = await this.copies.insert(bookId, barcode);
      this.tx.afterCommit(() => this.cache.evict(bookId));
      return copy;
    });
  }
}
