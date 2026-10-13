-- Demo data. Passwords (bcrypt, cost 10):
--   librarian@library.test / librarian-pass-123   (LIBRARIAN)
--   member@library.test    / member-pass-123      (MEMBER)
--   member2@library.test   / member2-pass-123     (MEMBER)

INSERT INTO members (id, email, name, password_hash, role) VALUES
 ('00000000-0000-4000-8000-000000000001', 'librarian@library.test', 'Lena Librarian',
  '$2a$10$FSPp9v6VrubgnBqJXJDUk.NelZClF/aS5wOdnAVkMwiZnjY3qJURS', 'LIBRARIAN'),
 ('00000000-0000-4000-8000-000000000002', 'member@library.test', 'Marko Member',
  '$2a$10$2y8pGw4WYn0XuOuQR857b.1wYfKCIsmZMTYqWRbTerXZqsOjocNkG', 'MEMBER'),
 ('00000000-0000-4000-8000-000000000003', 'member2@library.test', 'Mila Member',
  '$2a$10$kAfy3ayUnfmApkxB5ldXheNvZS5l/olM7dDpT4n5eXjOpSqt/XUja', 'MEMBER');

INSERT INTO authors (id, name, bio) VALUES
 ('10000000-0000-4000-8000-000000000001', 'Robert C. Martin', 'Software craftsman, author of Clean Code.'),
 ('10000000-0000-4000-8000-000000000002', 'Martin Kleppmann', 'Researcher in distributed systems.'),
 ('10000000-0000-4000-8000-000000000003', 'Eric Evans', 'Author of Domain-Driven Design.'),
 ('10000000-0000-4000-8000-000000000004', 'Kent Beck', 'Creator of Extreme Programming and TDD.'),
 ('10000000-0000-4000-8000-000000000005', 'Ivo Andric', 'Nobel laureate in literature, 1961.');

INSERT INTO books (id, isbn, title, description, published_year, tags) VALUES
 ('20000000-0000-4000-8000-000000000001', '9780132350884', 'Clean Code',
  'A handbook of agile software craftsmanship.', 2008, '{software,craftsmanship}'),
 ('20000000-0000-4000-8000-000000000002', '9781449373320', 'Designing Data-Intensive Applications',
  'The big ideas behind reliable, scalable and maintainable systems.', 2017, '{software,distributed-systems,databases}'),
 ('20000000-0000-4000-8000-000000000003', '9780321125217', 'Domain-Driven Design',
  'Tackling complexity in the heart of software.', 2003, '{software,architecture}'),
 ('20000000-0000-4000-8000-000000000004', '9780321146533', 'Test Driven Development: By Example',
  'Red, green, refactor.', 2002, '{software,testing}'),
 ('20000000-0000-4000-8000-000000000005', '9788652117895', 'The Bridge on the Drina',
  'Four centuries of history around the bridge in Visegrad.', 1945, '{novel,history}');

INSERT INTO book_authors (book_id, author_id, position) VALUES
 ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 1),
 ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 1),
 ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 1),
 ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', 1),
 ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005', 1);

INSERT INTO copies (book_id, barcode) VALUES
 ('20000000-0000-4000-8000-000000000001', 'CC-0001'),
 ('20000000-0000-4000-8000-000000000001', 'CC-0002'),
 ('20000000-0000-4000-8000-000000000002', 'DDIA-0001'),
 ('20000000-0000-4000-8000-000000000002', 'DDIA-0002'),
 ('20000000-0000-4000-8000-000000000002', 'DDIA-0003'),
 ('20000000-0000-4000-8000-000000000003', 'DDD-0001'),
 ('20000000-0000-4000-8000-000000000004', 'TDD-0001'),
 ('20000000-0000-4000-8000-000000000005', 'DRINA-0001');
