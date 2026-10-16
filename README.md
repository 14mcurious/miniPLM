# Mini PLM

Mini PLM is a React single-page application with:

- a **Login** page (`/login`) — the only public entry point
- a **Home** page (`/`) with the entry points to the two areas
- an **Administration** area (`/administration`)
- a **Work Area** (`/work-area`)

## Authentication and access control

Authentication is mandatory to enter the system. It is performed with a
**login name + password + email one-time code (OTP)** in two steps:

1. **Credentials** (`v1/auth`, `operation: login`) — verifies the login name
   and password (bcrypt). On success a 6-digit OTP is generated and "sent" by
   email. Every credential failure (unknown login name, wrong password,
   disabled account) answers with the **same** message: `wrong credentials`.
2. **OTP** (`v1/auth`, `operation: verify-otp`) — verifies the one-time code.
   The code is stored in Redis with a short TTL (default 5 minutes) and a
   bounded number of attempts, and is single-use. Any OTP failure (wrong code,
   expired, attempts exhausted) and a user that **belongs to no enabled
   group** also answer with the same `wrong credentials` message, so the
   endpoint never leaks which check failed.

> **Email transport.** When no email provider is configured (the `settings`
> key `email_provider` is `none`, which is the default here), the OTP cannot
> be delivered for real; the login response then returns it as `demoOtp`
> (`delivery: "dev"`) so the flow can be completed and tested. With a provider
> configured (`email_provider != none`) the code is delivered by email only
> and the response does not contain it.

### Session and CSRF

On a successful OTP verification a session is opened:

- **Opaque session token** — a cryptographically random token stored only in
  Redis (key built from `ctx.REDIS_PREFIX`) with a **configurable TTL
  (default 6 hours)**. The browser persists only the opaque token.
- **CSRF token** — generated with the session, bound to it, and having the
  **same lifetime and lifecycle**. State-changing calls must send it in the
  `x-csrf-token` header matching the session's stored value; a mismatch is
  rejected.
- **Single active session** — a user can hold only one active session: a new
  login invalidates the previous session token.
- **Extension** — 10 minutes (configurable) before expiry the user is asked
  whether to extend the session. Extending renews the TTL for a full duration
  and keeps the same token/CSRF pair. If the user declines, the session ends
  at its natural expiry and a fresh login is required.

### Roles and areas

- **Administration area** (`/administration/*`) — accessible **only** to
  members of the special **SysAdmin** group. Every admin endpoint
  (`v1/users`, `v1/groups`, `v1/projects`, admin `v1/auth` settings) re-checks
  the session *and* the SysAdmin role server-side on each request. The
  SysAdmin group has no project attachment, so by default its members get
  **no work area access**.
- **Work Area** (`/work-area`) — a work area is associated **1-to-1** with a
  project and carries the project's own name. A user sees and enters only the
  work areas of the projects attached to the (enabled) groups the user
  belongs to. All operations inside a work area stay scoped to the selected
  project.

### Default administrator

A default administrator account is seeded idempotently by the setup action:

- login name: `admin`
- default password: `Change m3`
- member of the `SysAdmin` group

Change this password after the first login.

## Internationalization

All UI texts, titles, labels, descriptions and error messages are resolved
through a key-value translation layer (`src/i18n`):

- default language: English (`src/i18n/translations/en.json`)
- additional catalogs live next to it (e.g. `it.json` for Italian)

To add a language: create a flat key/value JSON file in
`src/i18n/translations` with the same key set and register it in the
`translations` map of `src/i18n/i18n.ts`. Keys missing from a catalog fall
back to English; unknown keys are shown as-is. The active language is
selectable from the top-right switcher and is persisted in the browser.
