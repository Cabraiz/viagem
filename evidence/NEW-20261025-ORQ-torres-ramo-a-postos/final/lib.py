# Etapa 2: helpers for the Codex sheets (chroma green with the drawn shadow kept as black alpha, grid split, bounds).
from PIL import Image
import numpy as np

HERO_PX = 154  # the hero's figure in tower-art px (refs-lib.mjs)


def key(img):
    """Chroma key #00FF00. Green-dominant pixels become black with alpha = how dark the green is (the drawn shadow
    survives as a soft black shadow); the object keeps its colour with the green spill removed."""
    a = np.asarray(img.convert('RGB')).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = g - np.maximum(r, b)
    out = np.zeros(a.shape[:2] + (4,), np.float32)
    out[..., :3] = a
    out[..., 3] = 255
    # spill: object pixels slightly green -> clamp green
    spill = (m > 0)
    out[..., 1] = np.where(spill, np.maximum(r, b), g)
    # background / shadow: strongly green pixels
    bg = m > 60
    # shadow strength from the green's darkness (pure #00FF00 -> 0), black colour
    sh = np.clip(1 - g / 235.0, 0, 1) * 255
    sh = np.where(sh < 18, 0, sh)
    out[..., 3] = np.where(bg, sh, out[..., 3])
    out[..., :3] = np.where(bg[..., None], 0, out[..., :3])
    # anti-aliased edge between object and green: partial alpha, keep the object colour
    edge = (m > 20) & (m <= 60)
    out[..., 3] = np.where(edge, np.maximum(255 * (60 - m) / 40, sh), out[..., 3])
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGBA')


def grid(img, cols, rows):
    w, h = img.size
    cw, ch = w / cols, h / rows
    return [[img.crop((round(c * cw), round(r * ch), round((c + 1) * cw), round((r + 1) * ch))) for c in range(cols)] for r in range(rows)]


def bounds(img, thr=200):
    """Bounding box of the opaque drawing (alpha > thr: the object, not its soft shadow)."""
    a = np.asarray(img)[..., 3]
    ys, xs = np.nonzero(a > thr)
    if not len(xs):
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def clear_border(img, pad=2):
    """Nothing within pad px of the cell border (atlas bleed)."""
    a = np.array(img)
    a[:pad, :, 3] = 0; a[-pad:, :, 3] = 0; a[:, :pad, 3] = 0; a[:, -pad:, 3] = 0
    return Image.fromarray(a, 'RGBA')


def drop_islands(img, min_px=150, thr=40):
    """Erase loose specks (alpha components smaller than min_px besides the biggest)."""
    from scipy import ndimage  # noqa
    a = np.array(img)
    lab, n = ndimage.label(a[..., 3] > thr)
    if n <= 1:
        return img, 0
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    big = sizes.argmax() + 1
    kill = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s < min_px and i + 1 != big])
    a[kill, 3] = 0
    return Image.fromarray(a, 'RGBA'), int(kill.sum())


def sheet_on_grey(cells, cols, scale=1, bg=(150, 150, 150, 255), labels=None):
    w, h = cells[0].size
    rows = (len(cells) + cols - 1) // cols
    out = Image.new('RGBA', (cols * w, rows * h), bg)
    for i, c in enumerate(cells):
        out.alpha_composite(c, ((i % cols) * w, (i // cols) * h))
    if labels:
        from PIL import ImageDraw
        d = ImageDraw.Draw(out)
        for i, t in enumerate(labels):
            d.text(((i % cols) * w + 4, (i // cols) * h + 2), str(t), fill=(255, 255, 0, 255))
    if scale != 1:
        out = out.resize((round(out.width * scale), round(out.height * scale)), Image.LANCZOS)
    return out


def drop_border_pieces(img, thr=6, pad=3):
    """Erase stray pieces besides the biggest: bits of the neighbouring grid cells. A piece touching the crop's bottom
    or sides goes (the next row's helmets); one touching the top goes when flat (< 15 px tall: the feet of the row
    above; a helmet that jumps off the head is taller); one wholly below the figure's feet goes."""
    from scipy import ndimage  # noqa
    a = np.array(img)
    lab, n = ndimage.label(a[..., 3] > thr)
    if n <= 1:
        return img, 0
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    big = sizes.argmax() + 1
    objs = ndimage.find_objects(lab)
    feet = objs[big - 1][0].stop
    h, w = lab.shape
    kill = []
    for i, sl in enumerate(objs, 1):
        if i == big or sl is None:
            continue
        ys, xs = sl
        if ys.stop > h - pad or xs.start < pad or xs.stop > w - pad or (ys.start < pad and ys.stop - ys.start < 15) or ys.start > feet - 5:
            kill.append(i)
    k = np.isin(lab, kill)
    a[k, 3] = 0
    return Image.fromarray(a, 'RGBA'), int(k.sum())


def clean_cell(img):
    """Keyed grid cell → the figure alone: loose specks, then stray solid pieces (alpha > 40), then the soft ones left
    (the neighbours' shadows, alpha > 6)."""
    img = drop_islands(img, 200)[0]
    img = drop_border_pieces(img, 40)[0]
    return drop_border_pieces(img, 6)[0]
