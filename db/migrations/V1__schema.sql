-- Library API schema, shared by both implementations (Flyway in Java, a small SQL runner in TypeScript).
-- Invariants live in the database too, not only in code: a copy can be on one active loan only,
-- a member can hold one open reservation per book, status values are checked.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE members (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email            text        NOT NULL,
    name             text        NOT NULL,
    password_hash    text        NOT NULL,
    role             text        NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('MEMBER', 'LIBRARIAN')),
    status           text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
    max_active_loans int         NOT NULL DEFAULT 3 CHECK (max_active_loans BETWEEN 1 AND 10),
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_members_email ON members (lower(email));

CREATE TABLE authors (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text        NOT NULL,
    bio        text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_authors_created ON authors (created_at, id);

CREATE TABLE books (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    isbn           text        NOT NULL UNIQUE CHECK (isbn ~ '^97[89][0-9]{10}$'),
    title          text        NOT NULL,
    description    text,
    published_year int CHECK (published_year BETWEEN 1450 AND 2100),
    tags           text[]      NOT NULL DEFAULT '{}',
    version        int         NOT NULL DEFAULT 1,      -- optimistic locking; exposed as the ETag
    search         tsvector    NOT NULL DEFAULT ''::tsvector,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_books_title ON books (lower(title), id);                 -- default sort + cursor
CREATE INDEX ix_books_year ON books (published_year DESC NULLS LAST, id);
CREATE INDEX ix_books_tags ON books USING gin (tags);
CREATE INDEX ix_books_search ON books USING gin (search);
CREATE INDEX ix_books_title_trgm ON books USING gin (title gin_trgm_ops); -- typo-tolerant title search

CREATE TABLE book_authors (
    book_id   uuid NOT NULL REFERENCES books (id) ON DELETE CASCADE,
    author_id uuid NOT NULL REFERENCES authors (id) ON DELETE RESTRICT,
    position  int  NOT NULL,
    PRIMARY KEY (book_id, author_id)
);
CREATE INDEX ix_book_authors_author ON book_authors (author_id);

-- Keep books.search up to date from title, description and author names.
CREATE FUNCTION refresh_book_search(p_book_id uuid) RETURNS void LANGUAGE sql AS $$
    UPDATE books b SET search =
        setweight(to_tsvector('simple', coalesce(b.title, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce((SELECT string_agg(a.name, ' ')
                                                  FROM book_authors ba JOIN authors a ON a.id = ba.author_id
                                                  WHERE ba.book_id = b.id), '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(b.description, '')), 'C')
    WHERE b.id = p_book_id;
$$;

CREATE FUNCTION trg_books_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' OR NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description THEN
        PERFORM refresh_book_search(NEW.id);
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER books_search AFTER INSERT OR UPDATE OF title, description ON books
    FOR EACH ROW EXECUTE FUNCTION trg_books_search();

CREATE FUNCTION trg_book_authors_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM refresh_book_search(coalesce(NEW.book_id, OLD.book_id));
    RETURN NULL;
END $$;
CREATE TRIGGER book_authors_search AFTER INSERT OR DELETE ON book_authors
    FOR EACH ROW EXECUTE FUNCTION trg_book_authors_search();

CREATE TABLE copies (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id    uuid        NOT NULL REFERENCES books (id) ON DELETE CASCADE,
    barcode    text        NOT NULL UNIQUE,
    status     text        NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'ON_LOAN', 'RESERVED', 'LOST')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_copies_book_status ON copies (book_id, status);

CREATE TABLE loans (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    copy_id     uuid        NOT NULL REFERENCES copies (id),
    book_id     uuid        NOT NULL REFERENCES books (id),
    member_id   uuid        NOT NULL REFERENCES members (id),
    borrowed_at timestamptz NOT NULL DEFAULT now(),
    due_at      timestamptz NOT NULL,
    returned_at timestamptz,
    fee_cents   int CHECK (fee_cents >= 0),
    overdue_notified_at timestamptz,
    CHECK (due_at > borrowed_at),
    CHECK (returned_at IS NULL OR returned_at >= borrowed_at)
);
-- the last line of defence against double lending: one open loan per copy
CREATE UNIQUE INDEX ux_loans_open_copy ON loans (copy_id) WHERE returned_at IS NULL;
CREATE INDEX ix_loans_member_open ON loans (member_id) WHERE returned_at IS NULL;
CREATE INDEX ix_loans_member_borrowed ON loans (member_id, borrowed_at DESC, id);
CREATE INDEX ix_loans_due_open ON loans (due_at) WHERE returned_at IS NULL;

CREATE TABLE reservations (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id      uuid        NOT NULL REFERENCES books (id) ON DELETE CASCADE,
    member_id    uuid        NOT NULL REFERENCES members (id),
    status       text        NOT NULL DEFAULT 'WAITING'
                 CHECK (status IN ('WAITING', 'READY', 'FULFILLED', 'CANCELLED', 'EXPIRED')),
    held_copy_id uuid REFERENCES copies (id),
    ready_until  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CHECK ((status = 'READY') = (held_copy_id IS NOT NULL AND ready_until IS NOT NULL))
);
CREATE UNIQUE INDEX ux_reservations_open ON reservations (book_id, member_id) WHERE status IN ('WAITING', 'READY');
CREATE INDEX ix_reservations_queue ON reservations (book_id, created_at, id) WHERE status = 'WAITING';
CREATE INDEX ix_reservations_ready ON reservations (ready_until) WHERE status = 'READY';

-- Idempotency-Key store for POST /loans (kept 24 h)
CREATE TABLE idempotency_keys (
    subject         text        NOT NULL,   -- member id from the token
    key             text        NOT NULL,
    request_hash    text        NOT NULL,   -- sha-256 of method + path + body
    response_status int,
    response_body   jsonb,
    response_headers jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (subject, key)
);
CREATE INDEX ix_idempotency_created ON idempotency_keys (created_at);

-- Transactional outbox: written in the same transaction as the change, published by a background worker
CREATE TABLE outbox (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    aggregate_type text        NOT NULL,
    aggregate_id   uuid        NOT NULL,
    event_type     text        NOT NULL,   -- loan.created, loan.returned, loan.overdue, reservation.ready ...
    payload        jsonb       NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    published_at   timestamptz,
    attempts       int         NOT NULL DEFAULT 0
);
CREATE INDEX ix_outbox_unpublished ON outbox (id) WHERE published_at IS NULL;

-- Where the publisher "sends" notifications (stands in for e-mail / a message broker)
CREATE TABLE notifications (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    outbox_id  bigint      NOT NULL UNIQUE REFERENCES outbox (id),   -- at-most-once delivery per event
    member_id  uuid REFERENCES members (id),
    kind       text        NOT NULL,
    payload    jsonb       NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
