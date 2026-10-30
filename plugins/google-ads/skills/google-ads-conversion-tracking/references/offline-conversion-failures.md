# Offline Conversion Failure Modes

Offline conversion imports (OCI) are how B2B sales-led customers upload closed-won deals back to Google Ads weeks or months after the original click. This is the only way Smart Bidding can learn from real revenue rather than from raw lead volume.

When done well, OCI is the highest-leverage tracking improvement for B2B sales-led — bidder switches from "find form-fillers" to "find buyers" overnight. When done poorly, the upload silently no-ops and the team thinks it's working.


## The contract: gclid → CRM lead record → upload

For OCI to work, every closed-won deal needs to carry the original gclid from first ad click. The chain:

1. User clicks ad → lands with `gclid` in URL
2. gclid is captured and persisted (see `identifier-persistence`)
3. User fills out lead form → gclid is written to the lead record in CRM alongside contact details
4. Lead progresses through sales pipeline (potentially over weeks)
5. Deal closes → automation reads the lead's stored gclid + close date + close value
6. Upload fires to Google Ads via `ConversionUploadService` with these three fields

Break any link and the chain fails. The most common break is step 3: gclid is captured in a cookie but never written to the lead record at signup, so by the time the deal closes, the gclid is unrecoverable.


## The seven failure modes

In rough order of frequency:

1. **gclid captured but never written to the CRM lead record.** Most common. Cookie has the gclid; signup form doesn't read the cookie and stuff it into a hidden field. Lead lands in CRM with no click ID. Closed-won can't be attributed weeks later.

2. **Wrong conversion action configured in Google Ads UI.** OCI requires a conversion action with source = "Import" and category = "Closed Won" (or similar). Teams often try to upload to a click-based conversion action; upload silently fails with "Invalid conversion action" buried in API response.

3. **Upload outside the conversion window.** Default click-through window is 90 days. Long sales cycles routinely exceed this. Extend the window to 540 days (the maximum) for B2B sales-led; flag in the brief if cycle length exceeds 90 days.

4. **Duplicate uploads inflating the count.** Without dedup logic (gclid + conversion_date + conversion_value as a unique key), retrying a failed batch or re-running a daily job double-counts conversions. Smart Bidding learns from inflated numbers and over-spends.

5. **Missing enhanced conversions for leads as fallback.** When gclid is lost (cookie evicted, user logged out, multi-device journey), enhanced conversions for leads can still match the close via hashed email/phone. Many setups skip this fallback and lose 20-40% of attribution.

6. **Wrong value being uploaded.** Common variants: uploading deal size instead of ACV, uploading total contract value instead of first-year value, currency mismatch (CRM in EUR, upload as USD without conversion). The bidder learns from whatever number you send.

7. **Upload firing on stage change rather than closed-won.** Some setups upload at MQL→SQL or SQL→Opportunity. This defeats the purpose — you might as well be optimizing on the original form submit. OCI must fire on the **terminal** value-confirming event (closed-won, paid contract, signed deal).


## What to put in the brief

For any B2B sales-led recommendation:

- **Required:** OCI as the primary conversion (or one of two primaries in hybrid motions).
- Specify: closed-won as the fire event; ACV as the value; 540-day click-through window.
- Specify the gclid → CRM contract for the IDE skill: hidden form field on signup, persist to lead record, read at close time, upload via `ConversionUploadService`.
- Recommend enhanced conversions for leads as the fallback path; specify hashed email + phone fields.
- Document dedup key (gclid + date + value) so retries don't inflate.

If you can read the CRM (through an MCP or an export), verify whether existing leads have gclid populated — that's a quick diagnostic for whether step 3 of the chain is working today.


## Common diagnostic signal

If "OCI conversions" in Google Ads is much lower than closed-won deals in the CRM for the same period, the chain is broken somewhere. Walk the chain in order — capture, persist, write to lead record, upload — and find the first step where the count drops.
