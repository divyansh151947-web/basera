import fs from 'node:fs';
import path from 'node:path';

/**
 * OPTIONAL 3D ambient music asset.
 *
 * `public/audio/basera-ambient.mp3` is a licensed track that is deliberately
 * NOT committed to the repo (see public/audio/README.md — never commit
 * copyrighted music). The tour is designed to run silently until an operator
 * drops the file in and rebuilds.
 *
 * Previously the tour always constructed an <audio> element and preloaded the
 * path on mount, which produced a guaranteed 404 for every /tour visit even
 * though the README promises "the 3D tour runs silently with no errors". We
 * detect the asset once, at build time, and expose the result to the client so
 * the sound control is never requested (and never shown) while it is absent.
 * Adding the file and rebuilding turns the whole audio feature back on with no
 * code change.
 */
const ambientAudioPath = path.join(process.cwd(), 'public', 'audio', 'basera-ambient.mp3');
const ambientAudioAvailable = fs.existsSync(ambientAudioPath);

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_TOUR_AMBIENT_AVAILABLE: String(ambientAudioAvailable),
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
  webpack: (config, { dev }) => {
    if (dev) {
      // Keep test/run artifacts out of the dev file watcher. The E2E runner
      // streams `e2e-server.log` and writes `e2e/screenshots/<run>/*.png`
      // into the project tree WHILE `next dev` is serving the suite; every
      // such write is a watcher event that can kick off a webpack rebuild,
      // and a rebuild racing an in-flight request made Next serve 404s for
      // pages/chunks (`ENOENT .next/build-manifest.json`) mid-run. Test
      // edits still trigger recompiles as before; only artifact writes are
      // ignored.
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          '**/node_modules/**',
          '**/.git/**',
          '**/.next/**',
          '**/out/**',
          '**/build/**',
          '**/dist/**',
          '**/e2e/**',
          '**/e2e-*.log',
          '**/e2e-*.txt',
          '**/e2e-*.out',
          '**/e2e-*.err',
          '**/e2e-results.json',
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
