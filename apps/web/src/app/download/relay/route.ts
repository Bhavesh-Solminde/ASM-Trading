// Friendly, memorable URL for the relay APK. Next.js serves the raw file
// statically from /downloads/asm-relay.apk (public/downloads/); this route
// only exists so operators can share a shorter link.
//
// The Location is intentionally a bare path — behind a reverse proxy
// req.url reports the internal origin (e.g. http://localhost:3000), so
// constructing an absolute URL from it would send the browser there. A
// relative Location is resolved by the browser against the URL it fetched,
// which is the public origin the operator actually shared.
export function GET(): Response {
  return new Response(null, {
    status: 307,
    headers: { Location: "/downloads/asm-relay.apk" },
  });
}
