const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

const isDev = process.env.NODE_ENV !== 'production';

module.exports = {
  mode: isDev ? 'development' : 'production',
  target: 'electron-renderer',
  entry: './src/renderer/index.tsx',
  output: {
    filename: 'renderer.bundle.js',
    path: path.resolve(__dirname, 'dist/renderer'),
    clean: true,
    // Ensure the bundle is written as UTF-8; prevents mojibake in minified
    // string literals that contain non-ASCII characters (arrows, ellipsis…)
    charset: true,
  },
  // Polyfill Node.js globals that some dependencies may expect
  node: {
    global: true,
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.jsx'],
    alias: {
      '@renderer': path.resolve(__dirname, 'src/renderer'),
    },
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.module\.scss$/,
        use: [
          isDev ? 'style-loader' : MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: { modules: { localIdentName: isDev ? '[local]__[hash:base64:5]' : '[hash:base64:8]' } },
          },
          {
            loader: 'sass-loader',
            options: { api: 'modern-compiler' },
          },
        ],
      },
      {
        test: /\.scss$/,
        exclude: /\.module\.scss$/,
        use: [
          isDev ? 'style-loader' : MiniCssExtractPlugin.loader,
          'css-loader',
          {
            loader: 'sass-loader',
            options: { api: 'modern-compiler' },
          },
        ],
      },
      {
        test: /\.(png|jpg|gif|svg|ico)$/i,
        type: 'asset/resource',
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/renderer/index.html',
      filename: 'index.html',
    }),
    // ── Built-in pages ────────────────────────────────────────────────────────
    // Copies every HTML page in src/renderer/ (except index.html, which is
    // emitted by HtmlWebpackPlugin) to dist/renderer/.  This glob-based rule
    // means adding a new game or built-in page requires only two steps:
    //   1. Drop the <name>.html file into src/renderer/
    //   2. Add the game entry to the GAMES catalogue in games.html
    // No manual registration here or in tab-manager.ts is necessary because
    // the space:// protocol handler in main.ts resolves space://<name> →
    // dist/renderer/<name>.html automatically.
    new CopyPlugin({
      patterns: [
        {
          from: './src/renderer/*.html',
          to:   '[name][ext]',
          // index.html is owned by HtmlWebpackPlugin — skip it here to avoid
          // a duplicate-asset warning in webpack's output.
          filter: (resourcePath) => !resourcePath.endsWith('index.html'),
        },
      ],
    }),
    ...(isDev ? [] : [new MiniCssExtractPlugin({ filename: 'renderer.css' })]),
  ],
  optimization: isDev ? {} : {
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          // Keep non-ASCII characters as literal UTF-8 (no \uXXXX escapes).
          // Without this, characters like …, →, ·, ✓ become mojibake when
          // the HTML file is served without an explicit charset header.
          output: {
            ascii_only: false,
          },
        },
      }),
    ],
  },
  devServer: {
    port: 3000,
    hot: true,
    static: [
      { directory: path.join(__dirname, 'dist/renderer') },
      { directory: path.join(__dirname, 'src/renderer'), publicPath: '/' },
    ],
    // Permissive headers for the Electron renderer (which treats localhost as
    // a remote origin).  CORS + COEP/COOP are needed for SharedArrayBuffer;
    // the CSP header is intentionally absent here – it is set at the session
    // level in main.ts so it only applies in production builds.
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Embedder-Policy': 'unsafe-none',
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    },
    devMiddleware: { writeToDisk: false },
  },
  devtool: isDev ? 'eval-source-map' : false,
};
