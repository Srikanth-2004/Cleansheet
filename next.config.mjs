/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    tsconfigPath: './tsconfig.web.json',
  },
  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '');
    return {
      fallback: apiBase ? [{ source: '/api/:path*', destination: `${apiBase}/api/:path*` }] : [],
    };
  },
};

export default nextConfig;
