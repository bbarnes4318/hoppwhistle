/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@hopwhistle/shared', '@hopwhistle/sdk'],
  output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  /**
   * The buyer pages were renamed to say what they are for: costs -> spend,
   * targets -> targeting, wallet -> billing. Redirects rather than kept
   * duplicates, so there is exactly one page behind each job. Temporary (307)
   * on purpose: a 308 sticks in browser caches, which is a bad trade for a
   * rename that costs one extra hop.
   */
  async redirects() {
    return [
      { source: '/buyer/costs', destination: '/buyer/spend', permanent: false },
      { source: '/buyer/targets', destination: '/buyer/targeting', permanent: false },
      { source: '/buyer/wallet', destination: '/buyer/billing', permanent: false },
    ];
  },

  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiUrl}/api/v1/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
