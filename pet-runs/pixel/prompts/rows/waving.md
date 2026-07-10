Create one horizontal animation strip for Codex pet `pixel`, state `waving`.

Use the attached canonical base for identity. Use the attached layout guide only for slot count, spacing, centering, and padding; do not draw the guide.

Output exactly 4 full-body frames in one left-to-right row on flat pure magenta #FF00FF. Treat the row as 4 invisible equal-width slots: one centered complete pose per slot, evenly spaced, with no overlap, clipping, empty slots, labels, or borders.

Identity: same pet in every frame: Tiny calico cat named Pixel in crisp pixel art. Cream base coat with bold orange and black calico patches, large green eyes, compact rounded body, triangular ears, short expressive tail. Emotional beats: idle is curled tightly asleep with subtle breathing and ear twitch; running/thinking is aggressive rapid typing on a miniature charcoal laptop physically touching the paws; jumping/success is a readable complete backflip cycle using body pose only; waiting is a motionless blank stare with very wide green eyes, facing the viewer expectantly. Preserve chunky pixel clusters, limited warm palette, dark single-pixel-style outline, no antialiasing, no shadows, no detached effects.. Preserve silhouette, face, proportions, markings, palette, material, style, and props.
Style: Pet-safe sprite: compact full-body mascot, readable in a 192x208 cell, clear silhouette, simple face, stable palette/materials, and crisp edges for chroma-key extraction. Style `pixel`: Pixel-art-adjacent digital mascot with a chunky silhouette, simple dark outline, limited palette, flat cel shading, and visible stepped edges. User style notes: Authentic tiny 16-bit-era pixel-art sprite aesthetic, crisp hard-edged square pixels, limited palette, readable at 192x208, consistent pixel scale across every frame..
Animation continuity: keep apparent pet scale and baseline stable within the row unless the state itself intentionally changes vertical position, such as `jumping`. Move the pose within the slot instead of redrawing the pet larger or smaller frame to frame.

State action: Greeting loop: paw or limb down, raised, tilted, and returning in a friendly attention gesture.

State requirements:
- Show the greeting through paw, hand, wing, or limb pose only.
- Do not draw wave marks, motion arcs, lines, sparkles, symbols, or floating effects around the gesture.

Clean extraction: crisp opaque edges, safe padding, no scenery, text, guide marks, checkerboard, shadows, glows, motion blur, speed lines, dust, detached effects, stray pixels, or chroma-key colors inside the pet.
