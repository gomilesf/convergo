# README art — generation prompts

All README images are AI-generated with **Gemini 3 Pro Image** (`fal-ai/nano-banana-pro`
on fal.ai), PNG output, then resized (logo → 512px PNG; banners → 1600px wide,
`cwebp -q 85`). To regenerate or extend the set, append the shared style suffix to every
prompt so new art stays on-system.

## Visual system

Vintage 1960s engineering handbook / patent-office technical drawing:
warm cream paper, precise black ink line work, one vermillion red-orange accent,
hand-set typography, hairline construction guidelines, corner crosshair registration
marks. All labels set large enough to read at 800px display width.

## Shared style suffix (append to every prompt)

> Style: vintage 1960s engineering handbook / patent-office technical drawing. Warm
> cream paper background with subtle print texture and slight age, precise black ink
> line work, one accent color: vermillion red-orange. Hand-set typography feel,
> hairline construction guidelines, small crosshair registration marks in the corners.
> Flat print, absolutely no glow, no neon, no gradients, no dark background. Tasteful,
> human, like a page from a classic engineering manual. ALL TEXT LARGE AND CLEARLY
> LEGIBLE when the image is displayed 800 pixels wide — no tiny annotations.

## og-image.jpg (1280×640)

Not a separate generation: `hero.webp`'s source PNG padded to 2:1 with the paper color
(`sips --padToHeightWidth 1584 3168 --padColor F4EAD5`), resized to 1280×640, JPEG q88
(GitHub's social-preview limit is 1 MB). Upload manually at
**repo Settings → General → Social preview** — GitHub has no API for it. Re-derive
whenever the hero changes.

## Brand-mark consistency

The canonical spiral mark is the "FIGURE 1" spiral on the right side of `hero.webp`.
`logo.png` and the FIG. 1B panel of `problem.webp` are **derived from it** by cropping
that region of the hero and passing it as a reference image to the edit endpoint
(`fal-ai/nano-banana-pro/edit`, `image_urls: [<crop>]`). When regenerating either
asset, always re-derive from the hero crop — a fresh text-only prompt will invent a
different spiral.

## logo.png (1:1, reference: hero spiral crop)

> Simplify the attached engineering figure into a clean square app icon, keeping the
> SAME spiral geometry: the bold black ink spiral arms sweeping inward to the solid
> black center dot, with the large vermillion checkmark on the center dot. REMOVE all
> annotations, dimension labels, arrows, dashed guide lines, caption text and
> registration marks — keep only the black spiral arms and the vermillion checkmark on
> the black center. Center it on a warm cream paper tile. Bold and readable at 32
> pixels. Absolutely no text.

## hero.webp (21:9)

> Wide hero banner for 'Convergo', an open-source engineering-discipline tool. Left
> two-thirds: the wordmark 'CONVERGO' set VERY LARGE in a bold grotesque sans-serif,
> with the first O drawn as a spiral that converges to a solid dot. Directly below, in
> large clearly readable type (at least one third the height of the wordmark), the
> tagline: 'plan / review / build — loops that terminate'. Right third: a single bold
> spiral that converges inward and terminates at a solid dot with a checkmark. All
> text must be large, crisp and readable when the image is 800 pixels wide. No other
> text anywhere.

## problem.webp (16:9, reference: hero spiral crop)

> Two-panel comparison figure from an engineering handbook, split screen with a thin
> vertical rule. RIGHT panel: a faithful copy of the attached spiral figure — the same
> bold black ink spiral arms converging to the solid black center dot with the large
> vermillion checkmark — WITHOUT the dimension annotations, keeping just a hairline
> crosshair; below it a LARGE bold hand-set caption in capitals: 'FIG. 1B -
> CONVERGING'. LEFT panel: the same drawing style but INVERTED in behavior: a
> vermillion red-orange spiral whose arms DIVERGE outward, growing wider and more
> ragged each revolution, shedding a few small broken square fragments, with NO center
> dot and NO checkmark, the outermost arm trailing off the top edge; below it a LARGE
> bold caption: 'FIG. 1A - DIVERGING'. The two figures match in scale and stroke
> weight so the contrast reads instantly. Only those two captions; no other text
> anywhere.

## gate.webp (16:9)

> Engineering handbook schematic of a quality gate, drawn in black ink on cream paper.
> From the left, a horizontal path forms two circular loops in sequence, labeled in
> LARGE hand-set capitals 'WORKER' under the first loop and 'REVIEWER' under the
> second. The path then reaches a vertical gate symbol drawn as two slim pillars,
> labeled below in LARGE capitals 'FRESH REVIEWER'. Past the gate, the line runs
> straight and ends at a solid vermillion dot with a white checkmark, labeled in LARGE
> capitals 'SHIP'. One vermillion DASHED arc is deflected back at the gate, curving
> back above the loops toward the start, labeled in LARGE capitals 'BLOCKER'. Exactly
> these five labels, all set large; arrowheads on the path showing direction; no other
> text.
