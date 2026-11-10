# IndianxTrade Diwali greeting video

Status: Completed one budget draft through the Higgsfield developer API using MiniMax Hailuo 2.3 Standard. Authenticated quote: $0.280. Request ID: 01a1b91b-e9c1-7a5e-a0e8-821cd3163091. Official wordmark and Hanken Grotesk text were composited locally. Desktop and mobile outputs are in apps/web/public/festive/ and displayed only on /diwali-preview. Earlier plugin attempts were rejected and did not create jobs. See diwali-greeting-video-request.json for the current request and output record.

## Direction

Budget preference: the user has very little money. Prefer one short economical draft, verify the quote before generation, and avoid multiple aspect-ratio generations or premium requests until the first draft is reviewed. The earlier two-video 40-credit plan is superseded.

Budget request: Seedance 2.0 Mini, one 5-second 720p 16:9 silent clip, quoted 5 credits. Use existing website overlays for exact text and logo. No automatic paid retries or additional variants.

Preserve the existing website identity: charcoal #080E16, panel #0E1820, blue #2F81F7, Hanken Grotesk typography and the official wordmark. Gold is reserved for fire, sparks and brass lamps. Keep the current preview separate from live pages.

## Generation prompt

An original premium photorealistic Diwali welcome animation for IndianxTrade's existing dark trading website. 8 seconds, one continuous fixed frontal camera slightly elevated over a matte blue-charcoal floor. Deep blue-charcoal #080E16 throughout, secondary #0E1820, very subtle cool blue #2F81F7 ambient edge light. Natural warm amber and gold only from fire and sparks. Clean refined realistic materials, deliberate movement.
0-0.7s: a small detailed brass chakri near lower centre catches a tiny ember, fine smoke ribbon.
0.7-2.5s: chakri accelerates into a physically grounded spin, emits varied fine golden sparks with bright heads and delicate curved trails, faint warm floor reflections; energetic but controlled.
2.5-3.6s: sparks open in a graceful outward sweep and fade, revealing three beautifully crafted brass oil diyas along the bottom quarter of the frame, central lamp larger, balanced smaller lamps on either side.
3.6-5.2s: calm realistic flames, soft warm reflections, two delicate distant fireworks blooms towards upper corners. Keep the middle 50 percent of the frame empty dark charcoal for crisp website text added later.
5.2-8s: hold a composed tableau, three warm lamps, occasional falling embers, very subtle blue ambience, particles settle. Calm final frame.
Soft ignition and airy spinning crackle, delicate distant pops, no music or voice or heavy bass. No text, no lettering, no logo, no watermark, no buttons: official brand and typography will be composited precisely later. No purple or magenta, no poster, no ornate gold lettering, no neon portal, no confetti, no huge explosions, no dense smoke, no camera shake, no rapid flashes, no trading-profit imagery.

## Deliverables

- Desktop/tablet: 16:9, eight seconds, landscape.
- Mobile: 9:16, eight seconds, separately composed portrait.
- Selected model: Kling v3.0, pro quality, sound on.
- Quoted cost: 20 credits per video, 40 total. Quote is not a submitted job.
- Composite the official wordmark, white Happy Diwali headline and muted greeting afterwards; keep the blue Continue and Skip controls as accessible website elements.
- Greeting: May your home be filled with light, and your celebrations with joy.
- Campaign ends at 2026-11-13 00:00 Asia/Kolkata.

## Prepared requests

```json
{
  "desktop": {
    "model": "kling3_0",
    "duration": 8,
    "mode": "pro",
    "sound": "on",
    "count": 1,
    "prompt": "An original premium photorealistic Diwali welcome animation for IndianxTrade's existing dark trading website. 8 seconds, one continuous fixed frontal camera slightly elevated over a matte blue-charcoal floor. Deep blue-charcoal #080E16 throughout, secondary #0E1820, very subtle cool blue #2F81F7 ambient edge light. Natural warm amber and gold only from fire and sparks. Clean refined realistic materials, deliberate movement.\n0-0.7s: a small detailed brass chakri near lower centre catches a tiny ember, fine smoke ribbon.\n0.7-2.5s: chakri accelerates into a physically grounded spin, emits varied fine golden sparks with bright heads and delicate curved trails, faint warm floor reflections; energetic but controlled.\n2.5-3.6s: sparks open in a graceful outward sweep and fade, revealing three beautifully crafted brass oil diyas along the bottom quarter of the frame, central lamp larger, balanced smaller lamps on either side.\n3.6-5.2s: calm realistic flames, soft warm reflections, two delicate distant fireworks blooms towards upper corners. Keep the middle 50 percent of the frame empty dark charcoal for crisp website text added later.\n5.2-8s: hold a composed tableau, three warm lamps, occasional falling embers, very subtle blue ambience, particles settle. Calm final frame.\nSoft ignition and airy spinning crackle, delicate distant pops, no music or voice or heavy bass. No text, no lettering, no logo, no watermark, no buttons: official brand and typography will be composited precisely later. No purple or magenta, no poster, no ornate gold lettering, no neon portal, no confetti, no huge explosions, no dense smoke, no camera shake, no rapid flashes, no trading-profit imagery. Landscape composition: spacious quiet centre, lamps group centred in bottom quarter.",
    "aspect_ratio": "16:9"
  },
  "mobile": {
    "model": "kling3_0",
    "duration": 8,
    "mode": "pro",
    "sound": "on",
    "count": 1,
    "prompt": "An original premium photorealistic Diwali welcome animation for IndianxTrade's existing dark trading website. 8 seconds, one continuous fixed frontal camera slightly elevated over a matte blue-charcoal floor. Deep blue-charcoal #080E16 throughout, secondary #0E1820, very subtle cool blue #2F81F7 ambient edge light. Natural warm amber and gold only from fire and sparks. Clean refined realistic materials, deliberate movement.\n0-0.7s: a small detailed brass chakri near lower centre catches a tiny ember, fine smoke ribbon.\n0.7-2.5s: chakri accelerates into a physically grounded spin, emits varied fine golden sparks with bright heads and delicate curved trails, faint warm floor reflections; energetic but controlled.\n2.5-3.6s: sparks open in a graceful outward sweep and fade, revealing three beautifully crafted brass oil diyas along the bottom quarter of the frame, central lamp larger, balanced smaller lamps on either side.\n3.6-5.2s: calm realistic flames, soft warm reflections, two delicate distant fireworks blooms towards upper corners. Keep the middle 50 percent of the frame empty dark charcoal for crisp website text added later.\n5.2-8s: hold a composed tableau, three warm lamps, occasional falling embers, very subtle blue ambience, particles settle. Calm final frame.\nSoft ignition and airy spinning crackle, delicate distant pops, no music or voice or heavy bass. No text, no lettering, no logo, no watermark, no buttons: official brand and typography will be composited precisely later. No purple or magenta, no poster, no ornate gold lettering, no neon portal, no confetti, no huge explosions, no dense smoke, no camera shake, no rapid flashes, no trading-profit imagery. Portrait composition: keep all three lamps close together in bottom quarter, reserve central area for logo and message.",
    "aspect_ratio": "9:16"
  }
}
```


## Current Kling 4.0 revision

The user requires a full six-second 1080p video and explicitly said not to shorten it. Budget cap is $4. Use the paper-wrapped, laminated printed-top ground chakri reference; keep logo and typography out of the generated footage; request realistic hiss, whirr and crackles. A six-second 1080p Kling 4.0 request estimated at $1.41 failed with insufficient balance. An earlier three-second 1080p material test completed before the correction and could not be cancelled; it is retained separately in artifacts/diwali/ and must not replace the final greeting. The current preview remains unchanged. No further paid submissions until the API balance/account discrepancy is resolved. See diwali-kling4-fullhd-request.json for the full-length request.
