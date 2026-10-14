// Backend development configuration must not make React's production bundle a development build.
process.env.NODE_ENV = 'production';
const { build } = await import('vite');
await build();
