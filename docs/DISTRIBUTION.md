# Publishing Rigo as an app

Rigo is an installable web app. A service worker lets it open without a
connection, and a manifest describes it to app stores. Company data and
sign-in are never cached. Publishing needs accounts that only the owner can
create; nothing below has been submitted.

## Ready now

- Install from the browser: on Android, Chrome › Install app; on iPhone,
  Safari › Share › Add to Home Screen.
- Offline launch:
  - A browser-only Rigo opens normally.
  - A shared company shows "You're offline" and keeps saved offline updates
    on the device.
- Each deployment replaces the cached app files (the service worker is
  stamped per build).

## Google Play (owner steps)

1. Create a Google Play developer account.
2. Package the site as a Trusted Web Activity, for example with PWABuilder
   (pwabuilder.com) using `https://rigo-app-dun.vercel.app`. Keep the
   signing key safe.
3. In Vercel, add these environment variables, then redeploy:
   - `RIGO_ANDROID_PACKAGE`: the app's package name, for example
     `com.example.rigo`.
   - `RIGO_ANDROID_SHA256`: the signing certificate SHA-256 fingerprint.
     Separate several with commas.

   The build then publishes `/.well-known/assetlinks.json`. Without them,
   no file is published.
4. Upload the package, the store listing and screenshots in Play Console.

## Apple App Store (owner steps)

1. Create an Apple Developer account.
2. Package with a wrapper (PWABuilder's iOS package or Capacitor) and submit
   with Xcode. Apple reviews apps that are mostly a website more strictly.
   Offline launch, installability and native-feeling navigation help.

## Billing (off)

- Early access is free. No payment details are collected and nothing is
  charged.
- Owners see plan and usage in App settings › Capabilities.
- Paid address lookups are counted per company per month. If
  `RIGO_GEOCODE_MONTHLY_LIMIT` is set, lookups stop at that number each month.
- Owner decisions still needed:
  - prices and plans;
  - a payment provider, for example Stripe;
  - how subscriptions work in store apps, since Apple and Google have rules
    for digital subscriptions bought inside apps.
