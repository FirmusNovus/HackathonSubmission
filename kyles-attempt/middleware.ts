export { auth as middleware } from "@/lib/auth/config";

export const config = {
  matcher: ["/client/:path*", "/lawyer/:path*", "/verify-lawyer"],
};
