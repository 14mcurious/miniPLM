import { api } from "@/lib/api";

/**
 * Best-effort warmup for the work-area OpenServerless actions.
 *
 * Action instances are recycled after a few minutes of inactivity; the first
 * request after that eats a cold start (tens of seconds, sometimes beyond the
 * gateway poll window). When the session is authenticated we fire one
 * lightweight call per work-area action so the pages the user visits next
 * render against warm instances.
 *
 * Failures are ignored on purpose: the pages themselves load the same data
 * with their own error handling.
 */
const WARMUP_CALLS: { path: string; body?: string }[] = [
  { path: "/api/my/v1/custom-types" },
  { path: "/api/my/v1/work-containers", body: '{"operation":"list"}' },
  { path: "/api/my/v1/templates", body: '{"operation":"list"}' },
  { path: "/api/my/v1/work-instances", body: '{"operation":"list"}' },
];

export function warmWorkAreaActions(): void {
  for (const call of WARMUP_CALLS) {
    const options = call.body
      ? { method: "POST", body: call.body }
      : undefined;
    api(call.path, options).catch(() => {
      // Intentionally swallowed: warmup is purely opportunistic.
    });
  }
}
