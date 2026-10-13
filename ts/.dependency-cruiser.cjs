/**
 * Hexagonal layering, enforced in `npm run lint`:
 *
 *   domain          pure TypeScript: no framework, no I/O, no other layer
 *   application     use cases + ports; may use domain and @nestjs/common (DI decorators only)
 *   infrastructure  adapters (Drizzle, Redis, jose, bcrypt, prom-client); implements application ports
 *   interface       HTTP (controllers, validation, problem details); talks to application, never to adapters
 *   modules         composition root: binds ports to adapters; only bootstrap imports it
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-is-pure',
      comment: 'The domain depends on nothing but itself (and Node built-ins).',
      severity: 'error',
      from: { path: '^src/domain' },
      to: { pathNot: ['^src/domain', '^(node:)?(crypto|buffer)$'], dependencyTypesNot: ['core'] },
    },
    {
      name: 'application-depends-inwards',
      comment: 'Use cases see the domain and their own ports; adapters are injected, never imported.',
      severity: 'error',
      from: { path: '^src/application' },
      to: { path: ['^src/(infrastructure|interface|modules|config)', '^src/generated'] },
    },
    {
      name: 'application-no-frameworks',
      comment: 'Only @nestjs/common (DI decorators, Logger) is allowed in the application layer.',
      severity: 'error',
      from: { path: '^src/application' },
      to: { dependencyTypes: ['npm'], pathNot: '^node_modules/@nestjs/common' },
    },
    {
      name: 'infrastructure-not-interface',
      severity: 'error',
      from: { path: '^src/infrastructure' },
      to: { path: '^src/(interface|modules)' },
    },
    {
      name: 'interface-not-infrastructure',
      comment: 'Controllers reach adapters only through application ports.',
      severity: 'error',
      from: { path: '^src/interface' },
      to: { path: '^src/(infrastructure|modules|config)' },
    },
    {
      name: 'only-bootstrap-uses-modules',
      severity: 'error',
      from: { path: '^src', pathNot: ['^src/modules', '^src/bootstrap\\.ts$'] },
      to: { path: '^src/modules' },
    },
    {
      name: 'no-orphans',
      severity: 'error',
      from: { orphan: true, pathNot: ['\\.d\\.ts$', '^src/(main|tracing)\\.ts$', '^src/generated'] },
      to: {},
    },
    {
      name: 'no-dev-deps-in-src',
      severity: 'error',
      from: { path: '^src' },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default', 'types'] },
  },
};
