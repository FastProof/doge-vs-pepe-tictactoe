// client/vite.config.cjs

/** @type {import('vite').UserConfig} */
module.exports = {
  server: {
    proxy: {
      '/proxy': {
        // The target now includes the full base path to your 'api' function
        target: 'http://127.0.0.1:5001/doge-pepe-staging2/us-west2/proxy',
        changeOrigin: true,
        // The rewrite rule now removes the '/api' prefix from the request path
        //rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
};