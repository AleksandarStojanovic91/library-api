import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { PasswordHasher } from '../../application/ports/services';

/** Cost 10 matches the seeded hashes; bcryptjs is pure JS, so no native build in the Docker image. */
const COST = 10;

@Injectable()
export class BcryptPasswordHasher implements PasswordHasher {
  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, COST);
  }

  verify(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
