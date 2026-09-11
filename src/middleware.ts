import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token as any;
    const path = req.nextUrl.pathname;

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
      authorized: ({ token }) => Boolean(token),
    },
    pages: { signIn: "/login" },
  }
);

export const config = {
  matcher: ["/dashboard/:path*", "/leads/:path*", "/properties/:path*", "/team/:path*", "/appointments/:path*", "/analytics/:path*", "/settings/:path*", "/admin/:path*", "/conversations/:path*"],
};
