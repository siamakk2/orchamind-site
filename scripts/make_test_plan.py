#!/usr/bin/env python3
"""Draw the estimator's regression fixture: a plan sheet with KNOWN numbers.

Synthetic on purpose. No customer drawing is involved, and because we wrote the
figures we can check an extraction exactly instead of squinting at it.

The area figures are comma-formatted four-digit numbers ("1,312") because the
failure mode this product fears most is a dropped leading digit turning 1,312
into 312 and poisoning every quantity derived from it.

    python3 scripts/make_test_plan.py   ->   media/test-plan.png

Truth lives in scripts/test-plan-truth.json so the probe checks against one
source rather than a copy.
"""
import json
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, 'media')
OUT_PNG = os.path.join(OUT_DIR, 'test-plan.png')
TRUTH_JSON = os.path.join(HERE, 'test-plan-truth.json')

W, H = 2200, 1700
BLACK, GREY, WHITE = (0, 0, 0), (120, 120, 120), (255, 255, 255)


def font(size, bold=False):
    names = (['DejaVuSans-Bold.ttf', 'LiberationSans-Bold.ttf'] if bold
             else ['DejaVuSans.ttf', 'LiberationSans-Regular.ttf'])
    for d in ('/usr/share/fonts/truetype/dejavu/', '/usr/share/fonts/truetype/liberation/', ''):
        for n in names:
            try:
                return ImageFont.truetype(d + n, size)
            except Exception:
                continue
    return ImageFont.load_default()


def dim_line(d, x0, y0, x1, y1, label, fnt, vertical=False):
    """A dimension string with tick marks, the way a sheet prints one."""
    d.line([(x0, y0), (x1, y1)], fill=BLACK, width=2)
    t = 9
    if vertical:
        d.line([(x0 - t, y0), (x0 + t, y0)], fill=BLACK, width=2)
        d.line([(x1 - t, y1), (x1 + t, y1)], fill=BLACK, width=2)
        img = Image.new('RGBA', (240, 40), (255, 255, 255, 0))
        ImageDraw.Draw(img).text((0, 0), label, font=fnt, fill=BLACK)
        img = img.rotate(90, expand=True)
        d._image.paste(img, (int(x0) - 46, int((y0 + y1) / 2) - 110), img)
    else:
        d.line([(x0, y0 - t), (x0, y0 + t)], fill=BLACK, width=2)
        d.line([(x1, y1 - t), (x1, y1 + t)], fill=BLACK, width=2)
        bb = d.textbbox((0, 0), label, font=fnt)
        d.rectangle([((x0 + x1) / 2 - (bb[2] - bb[0]) / 2 - 8, y0 - 17),
                     ((x0 + x1) / 2 + (bb[2] - bb[0]) / 2 + 8, y0 + 17)], fill=WHITE)
        d.text(((x0 + x1) / 2 - (bb[2] - bb[0]) / 2, y0 - (bb[3] - bb[1]) / 2 - 3),
               label, font=fnt, fill=BLACK)


def room(d, x0, y0, x1, y1, name, size, f_name, f_size, wall=7):
    d.rectangle([x0, y0, x1, y1], outline=BLACK, width=wall)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    bb = d.textbbox((0, 0), name, font=f_name)
    d.text((cx - (bb[2] - bb[0]) / 2, cy - 26), name, font=f_name, fill=BLACK)
    d.line([(cx - (bb[2] - bb[0]) / 2, cy + 2), (cx + (bb[2] - bb[0]) / 2, cy + 2)],
           fill=BLACK, width=2)
    bb2 = d.textbbox((0, 0), size, font=f_size)
    d.text((cx - (bb2[2] - bb2[0]) / 2, cy + 8), size, font=f_size, fill=BLACK)


def main():
    truth = json.load(open(TRUTH_JSON)) if os.path.exists(TRUTH_JSON) else None
    if truth is None:
        raise SystemExit('run scripts/make-test-plan.js first to write the truth file')

    img = Image.new('RGB', (W, H), WHITE)
    d = ImageDraw.Draw(img)
    d._image = img

    f_title = font(46, True)
    f_head = font(30, True)
    f_room = font(27, True)
    f_small = font(22)
    f_dim = font(24)
    f_tiny = font(19)

    # sheet border + title block
    d.rectangle([24, 24, W - 24, H - 24], outline=BLACK, width=4)
    d.line([(W - 620, 24), (W - 620, H - 24)], fill=BLACK, width=3)
    d.text((W - 596, 60), 'ORCHAMIND', font=f_title, fill=BLACK)
    d.text((W - 596, 118), 'TEST FIXTURE — SYNTHETIC', font=f_small, fill=GREY)
    d.line([(W - 596, 158), (W - 60, 158)], fill=BLACK, width=2)
    d.text((W - 596, 178), 'MAPLE RIDGE', font=f_head, fill=BLACK)
    d.text((W - 596, 216), 'TWO STORY RESIDENCE', font=f_small, fill=BLACK)
    d.text((W - 596, 252), 'SHEET A1 — MAIN FLOOR PLAN', font=f_tiny, fill=GREY)
    d.text((W - 596, 280), 'SCALE: 1/4" = 1\'-0"', font=f_tiny, fill=GREY)

    # ---- AREA SCHEDULE (the thing the estimator must read exactly) ----------
    sx, sy = W - 596, 360
    d.text((sx, sy), 'AREA SCHEDULE', font=f_head, fill=BLACK)
    d.line([(sx, sy + 40), (sx + 520, sy + 40)], fill=BLACK, width=3)
    y = sy + 56
    for r in truth['areaSchedule']:
        d.text((sx, y), r['label'], font=f_small, fill=BLACK)
        val = '{:,}'.format(r['sqft']) + ' SQ FT'
        bb = d.textbbox((0, 0), val, font=f_small)
        d.text((sx + 520 - (bb[2] - bb[0]), y), val, font=f_small, fill=BLACK)
        y += 40
    d.line([(sx, y + 4), (sx + 520, y + 4)], fill=BLACK, width=2)
    y += 18
    # Label on its own line, figure beneath it: a wide label and a wide number
    # on one row collide, and the fixture must test extraction, not the reading
    # of overlapping text.
    d.text((sx, y), 'TOTAL CONDITIONED AREA', font=f_small, fill=BLACK)
    tot = '{:,}'.format(truth['totalPrintedSqft']) + ' SQ FT'
    bb = d.textbbox((0, 0), tot, font=f_head)
    d.text((sx + 520 - (bb[2] - bb[0]), y + 32), tot, font=f_head, fill=BLACK)
    y += 48
    d.text((sx, y + 36), 'GARAGE AND PORCH NOT INCLUDED', font=f_tiny, fill=GREY)
    d.text((sx, y + 64), 'IN CONDITIONED AREA.', font=f_tiny, fill=GREY)

    d.text((sx, y + 120), 'GENERAL NOTES', font=f_head, fill=BLACK)
    d.line([(sx, y + 160), (sx + 520, y + 160)], fill=BLACK, width=2)
    for i, n in enumerate([
        '1.  TWO (2) STORY RESIDENCE.',
        '2.  ROOF: GABLE, 6:12 PITCH.',
        '3.  PLATE HEIGHT 9\'-0" MAIN,',
        '     8\'-0" UPPER.',
        '4.  WINDOWS: 7 FRONT, 6 REAR,',
        '     3 LEFT, 4 RIGHT. 20 TOTAL.',
        '5.  2x6 EXTERIOR WALLS.'
    ]):
        d.text((sx, y + 180 + i * 30), n, font=f_tiny, fill=BLACK)

    # ---- the plan itself ---------------------------------------------------
    PX0, PY0, PX1, PY1 = 190, 300, 1430, 1300   # 42'-0" x 34'-0"
    d.rectangle([PX0, PY0, PX1, PY1], outline=BLACK, width=9)

    midx = PX0 + int((PX1 - PX0) * 0.56)
    midy = PY0 + int((PY1 - PY0) * 0.52)

    room(d, PX0, PY0, midx, midy, 'LIVING', '19\'-6" x 16\'-0"', f_room, f_small)
    room(d, midx, PY0, PX1, midy, 'KITCHEN', '14\'-0" x 16\'-0"', f_room, f_small)
    room(d, PX0, midy, midx - 190, PY1, 'DINING', '13\'-0" x 12\'-6"', f_room, f_small)
    room(d, midx - 190, midy, PX1, PY1, 'GARAGE', '22\'-0" x 22\'-0"', f_room, f_small)

    # overall dimension strings
    dim_line(d, PX0, PY0 - 70, PX1, PY0 - 70, '42\'-0"', f_dim)
    dim_line(d, PX0 - 70, PY0, PX0 - 70, PY1, '34\'-0"', f_dim, vertical=True)

    d.text((PX0, PY1 + 40), 'MAIN FLOOR PLAN — 1,312 SQ FT', font=f_head, fill=BLACK)
    d.text((PX0, PY1 + 84), 'UPPER FLOOR PLAN SHOWN ON SHEET A2 — 1,174 SQ FT',
           font=f_small, fill=GREY)

    os.makedirs(OUT_DIR, exist_ok=True)
    img.save(OUT_PNG, 'PNG')
    print('wrote', os.path.relpath(OUT_PNG, ROOT), img.size)


if __name__ == '__main__':
    main()
