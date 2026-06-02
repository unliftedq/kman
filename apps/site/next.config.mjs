/** Deployed as a GitHub Pages project site at https://unliftedq.github.io/kman/. */
export const BASE_PATH = "/kman";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  basePath: BASE_PATH,
};

export default nextConfig;
