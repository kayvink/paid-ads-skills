# Identifier Persistence

Conversion attribution depends on click identifiers and UTMs being captured at the landing page and persisted reliably through to the conversion event. This is one of the most common silent failure modes — the URL parameter is visible at landing but lost by checkout, and no error is ever logged.

This document is the contract the conversion-tracking brief passes to the IDE skill (`setup-google-ads-tracking`), which does the actual implementation.


## Click identifiers

Google Ads injects one of three click IDs into landing-page URLs when auto-tagging is enabled:

- **gclid** — standard Google Ads click ID; appears on most search/display/PMax clicks
- **gbraid** — iOS app-attribution click ID; appears when iOS users click ads
- **wbraid** — web-to-app click ID; appears in cross-device app campaigns

All three must be captured. Most setups only handle gclid and silently lose iOS attribution.


## Capture and persist rules

When the landing page receives one of these parameters:

1. **Read from URL** on first page load.
2. **Write to first-party cookie** with these settings:
   - Path: `/` (NOT `/checkout`, `/signup`, or any sub-path — the cookie must be readable from every page)
   - Domain: naked apex (`.example.com`) so it's readable from `www.`, `app.`, `checkout.`, etc.
   - Expiry: 90 days minimum (matches default conversion window). 540 days for B2B with long sales cycles.
   - SameSite: `Lax` (Strict breaks cross-site landing flows; None requires Secure and is overkill)
3. **Also write to `localStorage`** as a backup. ITP and ad-blockers evict first-party cookies aggressively; localStorage is more durable.
4. **Preserve case exactly.** Do not lowercase, uppercase, or URL-decode. URL transformers and CMSes often lowercase params, which silently breaks Google Ads matching (zero match rate, no error).
5. **Don't overwrite with null.** If a subsequent navigation lands without the param, do not overwrite the stored value. Conditional write only.


## Cross-domain handoff

When the user moves between domains (e.g., `app.example.com` → `checkout.example.com`):

- Cookies do not transfer across domains, even subdomains, unless the cookie is explicitly set on the apex (`.example.com`). Confirm cookie domain is set correctly.
- If the apex-cookie pattern isn't possible (separate companies, separate apex domains), explicitly pass the identifier in the URL during cross-domain navigation, or stitch via a server-side session.
- Document the cross-domain hops in the brief so the IDE skill knows where to add identifier passing.


## UTM parameters

Capture and persist: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`.

- Same rules as click IDs: cookie + localStorage, path `/`, preserve case, conditional write.
- **Persist to user record on signup.** UTMs at first landing predict cohort behavior far better than UTMs at conversion (which are often empty because the user came back via direct traffic to complete purchase).
- Attach to conversion payload so they flow into the platform.


## Transaction / event IDs

Required for client/server deduplication. When the same conversion fires from both client-side (gtag, Pixel) and server-side (CAPI, offline upload), both sides must send the same identifier so the platform dedupes.

- Use the business transaction ID where one exists (`order_id`, `deal_id`, `subscription_id`).
- Where one doesn't (e.g., a lead form submit), generate a UUID at the event and pass it to both sides.
- Must be unique per conversion event. Reusing IDs across events causes the platform to discard the second one as a duplicate.


## User data for enhanced conversions

For enhanced-conversions hashing (recovers iOS/ad-blocker cohort):

- **Email:** lowercase, trim whitespace, strip dots from Gmail local-part, then SHA-256 hash, hex-encode.
- **Phone:** convert to E.164 (`+14155551234`), then SHA-256, hex-encode.
- **First name / last name:** lowercase, trim, strip diacritics, then SHA-256, hex-encode.
- **Address fields:** rarely worth the work for most accounts; only for ecom with high-value transactions where the match-rate lift justifies the engineering cost.

Hash on the client where the data is collected, OR on the server before sending to CAPI — never send unhashed PII to the ad platform.


## Verification

The brief should request the IDE skill verify each identifier in the contract:

- gclid/gbraid/wbraid: capture confirmed, cookie + localStorage confirmed, case preserved, persists across navigations
- UTMs: capture confirmed, persisted to user record on signup, attached to conversion payload
- Transaction ID: same value on client and server payloads, unique per event
- User data: hashed correctly, present on both client and server payloads

Any failure here is a high-priority finding for the brief.
