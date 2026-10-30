"""Cuts the lit side gallery out of the Tower render and flattens it (perspective-corrected) into the texture the
3D viewer shows behind the gallery glass, plus a shade version (greyscale, the violet glow taken out).
Corner points are pixel positions on renders/tower.png (1024 × 1536); re-check them if the render is remade."""
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).parent
OUT = HERE.parent / "shopify-theme" / "assets"
CORNERS = [(116, 294), (331, 254), (331, 1290), (116, 1207)]  # top-left, top-right, bottom-right, bottom-left
W, H = 450, 1140  # gallery aperture in mm, so the texture keeps its proportions

img = cv2.imread(str(HERE / "renders" / "tower.png"))
size = (W, H)
M = cv2.getPerspectiveTransform(np.float32(CORNERS), np.float32([(0, 0), (W, 0), (W, H), (0, H)]))
sun = cv2.warpPerspective(img, M, size, flags=cv2.INTER_LANCZOS4)
sun = cv2.resize(sun, (W * 2, H * 2), interpolation=cv2.INTER_CUBIC)
cv2.imwrite(str(OUT / "tc-tower-gallery-sun.jpg"), sun, [cv2.IMWRITE_JPEG_QUALITY, 86])
# Shade: no UV, so the prints are grey line art on white cotton and the backboard is plain off-white.
grey = cv2.cvtColor(sun, cv2.COLOR_BGR2GRAY).astype(np.float32)
# Lift the violet-lit backboard to an unlit off-white; keep the ink dark.
grey = 255 * (grey / 255) ** 0.55
grey = np.where(grey > 150, np.minimum(grey * 1.08, 245), grey * 0.85)
shade = cv2.cvtColor(grey.astype(np.uint8), cv2.COLOR_GRAY2BGR)
cv2.imwrite(str(OUT / "tc-tower-gallery-shade.jpg"), shade, [cv2.IMWRITE_JPEG_QUALITY, 86])
print("wrote gallery textures", sun.shape[1], "x", sun.shape[0])
