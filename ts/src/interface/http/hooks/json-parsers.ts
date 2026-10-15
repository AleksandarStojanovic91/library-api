import type { FastifyInstance } from 'fastify';
import { DomainError } from '../../../domain/shared/domain-error';

/**
 * JSON bodies (application/json and RFC 7396 application/merge-patch+json) go through Fastify's default,
 * prototype-poisoning safe parser. A parse failure becomes a DomainError right here: Nest would otherwise
 * wrap Fastify's error in a generic HttpException and the "Malformed JSON body" detail could not be told
 * apart from other 400s.
 *
 * An empty body is no body, whatever the Content-Type says: clients such as k6 or axios send
 * `Content-Type: application/json` on body-less POSTs like `/loans/{id}/return`, and the Java service accepts
 * those. Endpoints that need a body still reject it, in the ZodPipe, as a missing body.
 */
export function installJsonParsers(fastify: FastifyInstance): void {
  const parseJson = fastify.getDefaultJsonParser('error', 'error');
  fastify.removeContentTypeParser('application/json');
  fastify.addContentTypeParser(['application/json', 'application/merge-patch+json'], { parseAs: 'string' }, (request, body, done) => {
    if (body === '') {
      done(null, undefined);
      return;
    }
    void parseJson(request, body as string, (error, value) => {
      if (error) {
        done(new DomainError('validation-failed', 'Malformed JSON body'), undefined);
      } else {
        done(null, value);
      }
    });
  });
}
