"""Cut the logo badge (with Lenny and Nyla) off its sky/grass background with GrabCut.
Usage: cutout_logo.py SRC.jpg OUT.png"""
import sys, cv2, numpy as np
src, out = sys.argv[1], sys.argv[2]
img = cv2.imread(src)
H, W = img.shape[:2]
s = 1100 / W
small = cv2.resize(img, (int(W*s), int(H*s)), interpolation=cv2.INTER_AREA)
h, w = small.shape[:2]
# rectangle around the badge (fractions of width/height, measured on the logo)
x0, y0, x1, y1 = int(0.125*w), int(0.02*h), int(0.80*w), int(0.985*h)
mask = np.zeros((h, w), np.uint8)
bgd = np.zeros((1, 65), np.float64); fgd = np.zeros((1, 65), np.float64)
cv2.grabCut(small, mask, (x0, y0, x1-x0, y1-y0), bgd, fgd, 8, cv2.GC_INIT_WITH_RECT)
m = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
# keep the biggest blob, fill holes
n, lab, stats, _ = cv2.connectedComponentsWithStats(m)
big = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
m = np.where(lab == big, 255, 0).astype(np.uint8)
cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
filled = np.zeros_like(m); cv2.drawContours(filled, cnts, -1, 255, -1)
m = cv2.morphologyEx(filled, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
m = cv2.resize(m, (W, H), interpolation=cv2.INTER_LINEAR)
m = cv2.GaussianBlur(m, (7, 7), 0)
rgba = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA); rgba[:, :, 3] = m
ys, xs = np.where(m > 10)
rgba = rgba[ys.min():ys.max()+1, xs.min():xs.max()+1]
cv2.imwrite(out, rgba)
print(out, rgba.shape)
