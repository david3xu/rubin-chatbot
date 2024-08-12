/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: '10.128.138.175',
        port: '3000',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'global.curtin.edu.au',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;