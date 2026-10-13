package dev.stojanovic.library.adapters.in.web;

import dev.stojanovic.library.adapters.in.web.dto.PageResponse;
import dev.stojanovic.library.adapters.in.web.dto.ReservationCreateRequest;
import dev.stojanovic.library.adapters.in.web.dto.ReservationResponse;
import dev.stojanovic.library.adapters.in.web.support.Paging;
import dev.stojanovic.library.application.model.ReservationView;
import dev.stojanovic.library.application.page.PageRequest;
import dev.stojanovic.library.application.service.ReservationService;
import dev.stojanovic.library.domain.model.Actor;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/reservations")
class ReservationController {

    private final ReservationService reservations;
    private final Paging paging;

    ReservationController(ReservationService reservations, Paging paging) {
        this.reservations = reservations;
        this.paging = paging;
    }

    @GetMapping
    PageResponse<ReservationResponse> list(Actor actor,
                                           @RequestParam(required = false) @Min(1) @Max(100) Integer limit,
                                           @RequestParam(required = false) @Size(max = 500) String cursor,
                                           @RequestParam(required = false) UUID memberId,
                                           @RequestParam(required = false) UUID bookId) {
        PageRequest page = paging.request(limit, cursor);
        return paging.response(reservations.list(actor, memberId, bookId, page), page, ReservationResponse::from);
    }

    @PostMapping
    ResponseEntity<ReservationResponse> reserve(Actor actor, @Valid @RequestBody ReservationCreateRequest request) {
        ReservationView reservation = reservations.reserve(actor, request.bookId());
        return ResponseEntity.created(URI.create("/api/v1/reservations/" + reservation.id()))
                .body(ReservationResponse.from(reservation));
    }

    @DeleteMapping("/{reservationId}")
    ResponseEntity<Void> cancel(Actor actor, @PathVariable UUID reservationId) {
        reservations.cancel(actor, reservationId);
        return ResponseEntity.noContent().build();
    }
}
