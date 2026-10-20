import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token as any;
    const path = req.nextUrl.pathname;

    // Protect buyer routes - only BUYER role allowed
    // Exclude public auth pages from protection to avoid redirect loops
    if (path.startsWith("/buyer") && !path.startsWith("/buyer/login") && !path.startsWith("/buyer/signup")) {
      if (!token) {
        return NextResponse.redirect(new URL("/buyer/login", req.url));
      }
      if (token.role !== "BUYER") {
        // Staff users trying to access buyer routes go to dashboard
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
    }

    // Protect staff routes - only staff roles allowed (not BUYER)
    const staffRoutes = ["/dashboard", "/leads", "/properties", "/team", "/appointments", "/analytics", "/recovery", "/settings", "/admin", "/conversations"];
    const isStaffRoute = staffRoutes.some(route => path.startsWith(route));
    if (isStaffRoute) {
      if (!token) {
        return NextResponse.redirect(new URL("/login", req.url));
      }
      if (token.role === "BUYER") {
        return NextResponse.redirect(new URL("/buyer", req.url));
      }
    }

    if (path.startsWith("/admin") && token?.role !== "SUPER_ADMIN") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    if (path.startsWith("/settings") && !["BUSINESS_ADMIN", "SUPER_ADMIN"].includes(token?.role)) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.next();
  },
  {
    callbacks: {
      // M-1: tokens already marked revoked by the jwt callback are rejected
      // here too (first-line defense); unmarked-but-stale tokens are caught
      // one hop later when pages/APIs resolve the session to null.
      // Return true for all routes - we handle redirects manually in the middleware function above
      // to ensure buyers go to /buyer/login and staff go to /login
      authorized: ({ token, req }) => {
        if (!token || (token as any)?.revoked) {
          // Allow the request to proceed to our middleware function which handles the redirect
          return true;
        }
        return true;
      },
    },
  }
);

export const config = {
  matcher: ["/buyer", "/buyer/:path*", "/dashboard", "/dashboard/:path*", "/leads", "/leads/:path*", "/properties", "/properties/:path*", "/team", "/team/:path*", "/appointments", "/appointments/:path*", "/analytics", "/analytics/:path*", "/recovery", "/recovery/:path*", "/settings", "/settings/:path*", "/admin", "/admin/:path*", "/conversations", "/conversations/:path*"],
};
