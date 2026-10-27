# Playground art

`server-room.png` was generated with the built-in image_gen tool on 2026-10-27.
It is the environment only. Racks, GPU counts, visitors and memory indicators
are drawn separately from live model data. The art is illustrative, not a
hardware specification. No external stock images or online assets are loaded.

Generation prompt:

```text
Use case: ui-mockup / game background asset. Create a wide landscape isometric PIXEL ART background for a cozy AI startup management game, approximately 16:10 composition, crisp deliberately pixelated detailed sprite aesthetic, warm cream / sage green / muted coral accents. Friendly light server room with cutaway walls at back, floor isometric tiles, morning light through a large window at back left, cable conduits and plants at room edges. LEFT THIRD: small service reception desk with 3 laptop terminals and empty chairs, clearly recognizable user intake zone. CENTER AND RIGHT TWO THIRDS: MOSTLY EMPTY tiled floor, three subtle small marked floor pads arranged diagonally for future server racks. Clear floor area so gameplay objects can be rendered on top, no rack or GPU at all. Bottom foreground also clear. No people, no envelopes, no conveyors, no server cabinets, no UI, no labels, no letters, no text, no logo, no watermark. Minimal tasteful workshop-like details on back wall edges only. Isometric camera looking down ~30 degrees, game floor centered. This is the actual background asset, not a screenshot/mock with menu or cards. Preserve generous empty gameplay space, no important objects at extreme edges. Avoid photorealism, smooth 3D rendering, dark cyberpunk, glossy gradients.
```

`worlds-concept.png` is the earlier concept comparison of the three settings.
`workshop.png` and `orbital.png` were generated on 2026-10-27 as edits of
`server-room.png`, preserving the camera, floor pads and reception layout.
The workshop uses wood benches and tool boards; the orbital station uses
cream hull panels and an Earth window. All three environments share live gameplay.
Environment prompt (workshop):

```text
Use case: precise-object-edit / game environment. Reference image is the edit target. Preserve EXACT isometric camera, image dimensions/aspect, floor silhouette, three marked empty rack floor pads and their coordinates, empty central/right gameplay space, and left reception desk with three laptops at same coordinates. No people, server racks, GPUs, envelopes, text, symbols, UI or numbers. Crisp detailed pixel-art game assets, same friendly cream/sage palette quality as reference. This is a world skin for one shared game, functional layout must remain identical. Transform the room into a warm computing workshop: wooden workbenches along back walls, pegboard with screwdrivers and spare cables, small component drawers, soldering bench at back, warm lamps, big left window to leafy garden. Reception desk becomes wood and painted green cabinetry but stays in same position with same laptops. Light tan wood floor tiles with same perspective grid and identical empty pads. Keep middle/right floor clear for separately drawn racks. Cozy maker studio, not cluttered factory. No new gameplay objects, no conveyor, no crates on empty pads.
```

Environment prompt (orbital):

```text
Use case: precise-object-edit / game environment. Reference image is the edit target. Preserve EXACT isometric camera, image dimensions/aspect, floor silhouette, three marked empty rack floor pads and their coordinates, empty central/right gameplay space, and left reception desk with three laptops at same coordinates. No people, server racks, GPUs, envelopes, text, symbols, UI or numbers. Crisp detailed pixel-art game assets, same friendly cream/sage palette quality as reference. This is a world skin for one shared game, functional layout must remain identical. Transform the room into an orbital scientific station bay: white cream pressure-hull wall panels and sage trim, gentle amber lamps, big window at back-left showing Earth and stars, tidy storage/tool cabinets along back walls, a few indoor hydroponic plants at edges. Reception desk becomes a light scientific console, exactly same location and laptops. Same light cream tiled floor and identical three rack pads at same coordinates. Keep empty floor in center/right. Friendly bright daytime interior, not a dark neon spaceship, no weapons, no astronauts, no new gameplay objects, no text.
```

### rack-shell.png
Generated with built-in image_gen on 2026-10-27; transparent background.

```text
Use case: stylized-concept. Asset type: transparent game sprite. A single empty isometric server cabinet for a friendly cozy pixel-art AI startup management game. Cream sage green painted metal, detailed pixel shading, little screws, vented right side, short feet, subtle floor shadow. Front faces viewer, right side visible, top visible, approximately 30 degree down camera. Cabinet upright portrait 3:5 proportion. IMPORTANT front opening is completely empty flat very dark sage rectangle with generous space for dynamic GPU modules drawn later by code: no GPUs, no shelves crossing opening, no text, no labels, no lights, no numbers. Cabinet fills canvas with modest transparent padding. Crisp small deliberate pixels, warm light from top left, not smooth vector, not photorealistic. Isolated single object, transparent background.
```

### visitor.png
Generated with built-in image_gen on 2026-10-27; transparent background.

```text
Use case: stylized-concept. Asset type: transparent game character sprite. Single friendly young adult customer sitting facing diagonally up-right at an invisible laptop desk, for a cozy isometric pixel art AI startup management game. Short dark brown hair, warm tan skin, muted blue shirt with rolled sleeves, dark trousers, small simple face, visible arms reaching forward to type. No laptop, no desk, no chair, no other props, no text. Approximately 30 degree down isometric view, crisp deliberately visible pixels, warm sunlight from upper left, detailed pixel shading consistent with cozy pixel game interiors. Full seated body centered, isolated transparent background, modest padding.
```
