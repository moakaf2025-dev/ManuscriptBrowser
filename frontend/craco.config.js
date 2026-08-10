// craco.config.js
const path = require("path");
require("dotenv").config();

// Check if we're in development/preview mode (not production build)
// Craco sets NODE_ENV=development for start, NODE_ENV=production for build
const isDevServer = process.env.NODE_ENV !== "production";

// Environment variable overrides
const config = {
  enableHealthCheck: process.env.ENABLE_HEALTH_CHECK === "true",
};

function makeDevServerV5Compatible(devServerConfig) {
  const {
    https,
    onAfterSetupMiddleware,
    onBeforeSetupMiddleware,
    onListening,
    setupMiddlewares,
    ...compatibleConfig
  } = devServerConfig;

  compatibleConfig.server =
    typeof https === "object"
      ? { type: "https", options: https }
      : https
        ? "https"
        : "http";
  compatibleConfig.headers = {
    ...compatibleConfig.headers,
    "Cross-Origin-Resource-Policy": "same-origin",
  };

  if (onBeforeSetupMiddleware || setupMiddlewares) {
    compatibleConfig.setupMiddlewares = (middlewares, devServer) => {
      if (onBeforeSetupMiddleware) {
        onBeforeSetupMiddleware(devServer);
      }

      return setupMiddlewares
        ? setupMiddlewares(middlewares, devServer)
        : middlewares;
    };
  }

  compatibleConfig.onListening = (devServer) => {
    devServer.close ??= (callback) => devServer.stopCallback(callback);

    if (onListening) {
      onListening(devServer);
    }
    if (onAfterSetupMiddleware) {
      onAfterSetupMiddleware(devServer);
    }
  };

  return compatibleConfig;
}

// Conditionally load health check modules only if enabled
let WebpackHealthPlugin;
let setupHealthEndpoints;
let healthPluginInstance;

if (config.enableHealthCheck) {
  WebpackHealthPlugin = require("./plugins/health-check/webpack-health-plugin");
  setupHealthEndpoints = require("./plugins/health-check/health-endpoints");
  healthPluginInstance = new WebpackHealthPlugin();
}

let webpackConfig = {
  eslint: {
    configure: {
      extends: ["plugin:react-hooks/recommended"],
      // no-undef is the point of this block. Without it a missing import
      // compiles cleanly and throws at runtime instead - which is exactly how a
      // lucide icon went missing from ManuscriptDialogs.jsx and took the snip
      // preview down with it. It needs env and parserOptions to know what a
      // browser global is, or every window/document reference would be flagged.
      env: { browser: true, es2021: true, node: true, jest: true },
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      rules: {
        "no-undef": "error",
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
      },
    },
  },
  webpack: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // CRA 5 runs babel over .js/.mjs files in node_modules, and it cannot compile
      // docx's ESM bundle ("super() in an arrow function with default or rest
      // parameters"). The CommonJS build is the same library and the rule does not
      // match .cjs, so it passes through untouched.
      docx: path.resolve(__dirname, 'node_modules/docx/dist/index.cjs'),
    },
    configure: (webpackConfig) => {
      // CRA's catch-all asset rule claims every extension it does not recognise,
      // and .cjs is not on its list. Left alone it copies docx's CommonJS bundle
      // into static/media and resolves the import to a URL string, so every
      // binding reads undefined at runtime while the build still succeeds. Teach
      // that rule to leave .cjs to the JavaScript pipeline.
      const oneOfContainer = webpackConfig.module.rules.find((r) => Array.isArray(r.oneOf));
      const assetFallback = oneOfContainer?.oneOf?.find(
        (r) => Array.isArray(r.exclude) && r.exclude.some((x) => String(x).includes("js|mjs|jsx|ts|tsx"))
      );
      if (!assetFallback) {
        throw new Error("craco: could not find CRA's asset fallback rule to exempt .cjs from it");
      }
      assetFallback.exclude.push(/\.cjs$/);

      // That bundle is already self-contained - no external requires, no ESM
      // syntax - but it embeds a browserify-style loader whose two-argument
      // require() webpack refuses to analyse. Nothing in it needs resolving, so
      // skip parsing it and let the CommonJS wrapper hand over module.exports.
      webpackConfig.module.noParse = /[\\/]node_modules[\\/]docx[\\/]dist[\\/]index\.cjs$/;

      // Add ignored patterns to reduce watched directories
        webpackConfig.watchOptions = {
          ...webpackConfig.watchOptions,
          ignored: [
            '**/node_modules/**',
            '**/.git/**',
            '**/build/**',
            '**/dist/**',
            '**/coverage/**',
            '**/public/**',
        ],
      };

      // Add health check plugin to webpack if enabled
      if (config.enableHealthCheck && healthPluginInstance) {
        webpackConfig.plugins.push(healthPluginInstance);
      }
      return webpackConfig;
    },
  },
};

webpackConfig.devServer = (devServerConfig) => {
  // Add health check endpoints if enabled
  if (config.enableHealthCheck && setupHealthEndpoints && healthPluginInstance) {
    const originalSetupMiddlewares = devServerConfig.setupMiddlewares;

    devServerConfig.setupMiddlewares = (middlewares, devServer) => {
      // Call original setup if exists
      if (originalSetupMiddlewares) {
        middlewares = originalSetupMiddlewares(middlewares, devServer);
      }

      // Setup health endpoints
      setupHealthEndpoints(devServer, healthPluginInstance);

      return middlewares;
    };
  }

  return devServerConfig;
};

// Wrap with visual edits (automatically adds babel plugin, dev server, and overlay in dev mode)
if (isDevServer) {
  try {
    const { withVisualEdits } = require("@emergentbase/visual-edits/craco");
    webpackConfig = withVisualEdits(webpackConfig);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND' && err.message.includes('@emergentbase/visual-edits/craco')) {
      console.warn(
        "[visual-edits] @emergentbase/visual-edits not installed — visual editing disabled."
      );
    } else {
      throw err;
    }
  }
}

const configureDevServer = webpackConfig.devServer;
webpackConfig.devServer = (devServerConfig) =>
  makeDevServerV5Compatible(configureDevServer(devServerConfig));

module.exports = webpackConfig;
