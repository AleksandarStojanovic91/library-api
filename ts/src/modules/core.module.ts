import { Global, Module, type DynamicModule } from '@nestjs/common';
import { TOKENS } from '../application/ports/tokens';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { FeeCalculator } from '../domain/lending/fee-calculator';
import { LoanPolicy } from '../domain/lending/loan-policy';
import { ReservationPolicy } from '../domain/lending/reservation';
import { SystemClock } from '../infrastructure/time/system-clock';

/** Configuration, the business clock and the domain policies built from configuration. */
@Global()
@Module({})
export class CoreModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: TOKENS.Clock, useValue: new SystemClock(config.clockOffsetSeconds) },
        { provide: LoanPolicy, useValue: new LoanPolicy(config.loanDays, new FeeCalculator(config.feeCentsPerDay)) },
        { provide: ReservationPolicy, useValue: new ReservationPolicy(config.reservationHoldHours) },
      ],
      exports: [APP_CONFIG, TOKENS.Clock, LoanPolicy, ReservationPolicy],
    };
  }
}
