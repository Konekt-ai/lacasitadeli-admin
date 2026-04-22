/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
       destination: 'https://lacasita-api-production.up.railway.app/api/:path*',
      },
    ];
  },
}
module.exports = nextConfig
