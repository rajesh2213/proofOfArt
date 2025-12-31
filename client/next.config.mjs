/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: false, 
  
  images: {
    unoptimized: true,
    domains: [],
  },
  
  serverExternalPackages: ["framer-motion"],

  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },

  webpack: (config, { isServer }) => {
    return config;
  },
};

export default nextConfig;

