"""Warps a shade photo onto its sun photo (similarity transform from ORB matches) so the sun sweep lines up.
Usage: python align_pair.py sun.png shade.png out.png"""
import sys

import cv2
import numpy as np

sun, shade, out = sys.argv[1:4]
a = cv2.imread(sun)
b = cv2.imread(shade)
ga, gb = (cv2.cvtColor(i, cv2.COLOR_BGR2GRAY) for i in (a, b))
# Edges only, so the sunbeam and colour differences don't drive the match.
ea, eb = (cv2.Canny(cv2.GaussianBlur(g, (5, 5), 0), 40, 120) for g in (ga, gb))
orb = cv2.ORB_create(6000)
ka, da = orb.detectAndCompute(cv2.addWeighted(ga, 0.5, ea, 0.5, 0), None)
kb, db = orb.detectAndCompute(cv2.addWeighted(gb, 0.5, eb, 0.5, 0), None)
matches = sorted(cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(db, da), key=lambda m: m.distance)[:800]
src = np.float32([kb[m.queryIdx].pt for m in matches])
dst = np.float32([ka[m.trainIdx].pt for m in matches])
M, inl = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=3)
scale = np.hypot(M[0, 0], M[1, 0])
print(f"inliers {int(inl.sum())}/{len(matches)}  scale {scale:.3f}  shift {M[0,2]:.1f},{M[1,2]:.1f}")
warped = cv2.warpAffine(b, M, (a.shape[1], a.shape[0]), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REPLICATE)
cv2.imwrite(out, warped)
