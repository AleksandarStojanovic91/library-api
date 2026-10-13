import { Global, Module } from '@nestjs/common';
import { TOKENS } from '../application/ports/tokens';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { BcryptPasswordHasher } from '../infrastructure/security/bcrypt-password-hasher';
import { JoseTokenService, JWT_SECRET } from '../infrastructure/security/jose-token-service';

@Global()
@Module({
  providers: [
    { provide: JWT_SECRET, inject: [APP_CONFIG], useFactory: (config: AppConfig) => config.jwtSecret },
    { provide: TOKENS.PasswordHasher, useClass: BcryptPasswordHasher },
    { provide: TOKENS.TokenService, useClass: JoseTokenService },
  ],
  exports: [TOKENS.PasswordHasher, TOKENS.TokenService],
})
export class SecurityModule {}
