# Diwali website experience: photo and keyframes first

The purpose is a temporary Diwali theme on IndianxTrade: a first-visit greeting,
subtle seasonal details afterwards, and brief fireworks with sound on confirmed
wins. Keep the website's blue-charcoal palette, official logo, Hanken Grotesk
type and existing trading colours. The campaign ends after November 12, India
time. Keep changes on the separate preview page until reviewed.

## Current workflow

The user explicitly requested establishing the photo and keyframes before
making the final video. Show a master photo and storyboard for review first.
Do not start another video generation during this stage. A top-view video
request was already processing when the instruction arrived and could not be
cancelled; it is recorded separately in diwali-overhead-request.json.

## Master photo

Use the user's latest reference for a new, unbranded paper/cardboard chakri:
red outer top, cyan-blue zigzag band, yellow inner ring and pale centre. A
red/blue/off-white paper-wrapped tube forms an exposed coil around its rim.
True 90-degree overhead camera. Matte #080E16 background, restrained #2F81F7
ambient light. No metal, side view, reference watermark or typography.

## Keyframes and target pacing

1. 0 seconds: fresh overhead chakri, full striped coil, dark empty surroundings.
2. About 2 seconds: clockwise spin and gold sparks; outer coil visibly burning.
3. About 5 seconds: almost-spent coil, singed paper, dwindling embers; maintain
   object identity and exact camera position, with no new tube appearing.
4. About 7 seconds: chakri fades as golden sparks open into aerial fireworks
   on the same charcoal background.
5. About 10 seconds: Happy Diwali in the website's white typography, fireworks
   around the edges, three lit diyas below and a short warm wish.
6. About 16 seconds: calm finish with the exact official IndianxTrade wordmark.

The finished greeting should retain approximately the reference's 17-second
length. Typographic overlays and the official logo remain separate from AI
footage so their rendering can be exact. Sound follows ignition, spin,
crackles, fireworks and a soft finish. No more video spend before keyframe
review; retain the user's $4 cap and audit completed and failed requests.

## Saved photo and generation method

Master photo: artifacts/diwali/storyboard/master-overhead-v1.png. Created with
the built-in image-generation tool, using the latest user chakri image as an
appearance reference. The storyboard is an image-first concept review; no
new video generation follows automatically. Final logo/text will be composited
from the real website assets, rather than trusting generated lettering.

## Prompt set

Master photo: photorealistic product photograph, locked 90-degree overhead
camera; preserve the reference red outer disc, cyan-blue zigzag band, yellow
inner ring and cream centre. Render laminated cardboard and fibrous folded
paper tube, with red/blue/off-white striped coil exposed at the perimeter and
a short fuse. Single unlit object centred on matte #080E16, subtle #2F81F7
ambient fill, generous empty surroundings. No metal, toy plastic, side view,
extra objects, writing, brand, watermark or UI.

Storyboard: one clean six-panel contact sheet, three columns by two rows, each
panel 16:9. Preserve the master object, material, exact overhead camera and
scale in panels 1-3. Show fresh coil, half-consumed burning coil with radial
sparks, then almost entirely spent/singed coil with a last ember. Transition
to gold/blue-white aerial fireworks, a white sans-serif Happy Diwali greeting
with three clay diyas, then a calm official-wordmark finish. Maintain charcoal
and brand blue throughout. Use the real logo reference, no replacement mark.
Caption the panels with their stage and 0/2/5/7/10/16-second timing.

## Storyboard review deliverables

- Master photo: artifacts/diwali/storyboard/master-overhead-v1.png
- Six-frame storyboard: artifacts/diwali/storyboard/storyboard-v1.png
- Both created with built-in image generation, not the Higgsfield dollar API.
- Check frames 2-3 for visible striped-coil consumption, the exact overhead
  view and paper material before animation. Frame 5 establishes the website
  greeting treatment; frame 6 uses the supplied logo as a visual reference.
- Production logo and text will use exact source assets rather than pixels
  redrawn in the storyboard. Await user feedback before assembling the final
  approximately 17-second video.
