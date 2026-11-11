"""Remove the white halo the logo has around its badge (it shows as pale patches on a colored background).
Near-white regions that touch the transparent outside are made transparent; white parts enclosed by outlines
(clouds, letters, the banner) stay. Usage: clean_badge.py IN.png OUT.png"""
import sys, cv2, numpy as np
img = cv2.imread(sys.argv[1], cv2.IMREAD_UNCHANGED)
b, g, r, a = cv2.split(img)
mn = np.minimum(np.minimum(r, g), b).astype(int); mx = np.maximum(np.maximum(r, g), b).astype(int)
whiteish = ((mn > 200) & (mx - mn < 60)).astype(np.uint8)
outside = (a < 128).astype(np.uint8)
seed = cv2.dilate(outside, np.ones((5, 5), np.uint8)) & whiteish
n, lab = cv2.connectedComponents(whiteish, connectivity=4)
touch = np.unique(lab[seed > 0]); touch = touch[touch > 0]
halo = np.isin(lab, touch).astype(np.uint8)
remove = cv2.dilate(halo, np.ones((3, 3), np.uint8))
alpha = np.where(remove > 0, 0, a).astype(np.uint8)
# drop specks left floating outside the main shape, then smooth the edge
n2, lab2, st, _ = cv2.connectedComponentsWithStats((alpha > 128).astype(np.uint8), connectivity=8)
keep = np.zeros_like(alpha)
big = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
for k in range(1, n2):
    if k == big or st[k, cv2.CC_STAT_AREA] > 1500: keep[lab2 == k] = 255
alpha = np.minimum(alpha, cv2.GaussianBlur(keep, (5, 5), 0))
out = cv2.merge([b, g, r, alpha])
ys, xs = np.where(alpha > 10)
out = out[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
cv2.imwrite(sys.argv[2], out)
print(sys.argv[2], out.shape, 'halo px removed:', int(halo.sum()))
