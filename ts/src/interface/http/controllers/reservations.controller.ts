import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { Reservations } from '../../../application/lending/reservations';
import type { Principal } from '../../../application/ports/services';
import type { components } from '../../../generated/openapi';
import { CurrentPrincipal } from '../auth/decorators';
import { presentPage, presentReservation } from '../presenters';
import { ReservationCreate, ReservationListQuery, uuidParam } from '../validation/schemas';
import { ZodPipe } from '../validation/zod.pipe';

type Schemas = components['schemas'];

@Controller('api/v1/reservations')
export class ReservationsController {
  constructor(@Inject(Reservations) private readonly reservations: Reservations) {}

  @Get()
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodPipe(ReservationListQuery, 'query')) query: z.output<typeof ReservationListQuery>,
  ): Promise<Schemas['ReservationPage']> {
    return presentPage(await this.reservations.list(principal, query), presentReservation);
  }

  @Post()
  async reserve(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodPipe(ReservationCreate)) body: z.output<typeof ReservationCreate>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Schemas['Reservation']> {
    const reservation = await this.reservations.reserve(principal, body.bookId);
    reply.header('Location', `/api/v1/reservations/${reservation.id}`);
    return presentReservation(reservation);
  }

  @Delete(':reservationId')
  @HttpCode(204)
  async cancel(@CurrentPrincipal() principal: Principal, @Param('reservationId', uuidParam('reservationId')) id: string): Promise<void> {
    await this.reservations.cancel(principal, id);
  }
}
