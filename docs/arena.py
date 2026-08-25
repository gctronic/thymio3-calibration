#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generates the calibration arena (21 x 77.5 cm) tiled over landscape A4 sheets.
All dimensions in mm, origin at the START edge.
"""
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.lib.colors import black, white, HexColor

# ---------------- ARENA PARAMETERS (mm) ----------------
W        = 210.0          # corridor width        (21 cm)
L        = 775.0          # total length          (77.5 cm = 5 sheets)
BAND_T   = 15.0           # black band thickness  (1.5 cm)
PITCH    = 150.0          # band pitch            (15 cm)
FIRST    = 230.0          # START -> first band   (23 cm)
N_BANDS  = 4

# ---------------- ROBOT FOOTPRINT (mm) ----------------
# Dashed outline of the robot, parked with its rear edge ON the START line.
# Local coordinates: x from the corridor centreline, y from the robot rear.
ROBOT_START = 0.0         # rear edge position, measured from START
ROBOT_LEN   = 127.926     # rear -> front tip
ROBOT_W     = 110.365     # overall width
ROBOT_MARK  = (0.0, 33.026, 4.578)   # centre mark: dx, dy, radius
ROBOT_DASH  = 4.2         # dash length of the outline
ROBOT_PATH = [
    ("M", -55.059, 0.000),
    ("L", -55.059, 68.721),
    ("C", -55.138, 69.931, -55.183, 71.151, -55.183, 72.381),
    ("C", -55.183, 74.154, -55.099, 75.908, -54.935, 77.639),
    ("L", -54.382, 81.797),
    ("C", -54.262, 82.495, -54.129, 83.188, -53.984, 83.876),
    ("C", -53.834, 84.931, -53.674, 85.618, -53.502, 86.300),
    ("L", -52.953, 88.312),
    ("C", -46.232, 111.208, -25.067, 127.926, 0.000, 127.926),
    ("C", 25.067, 127.926, 46.232, 111.208, 52.953, 88.312),
    ("L", 53.502, 86.300),
    ("C", 53.674, 85.618, 53.834, 84.931, 53.984, 83.876),
    ("C", 54.129, 83.188, 54.262, 82.495, 54.382, 81.797),
    ("L", 54.935, 77.639),
    ("C", 55.099, 75.908, 55.183, 74.154, 55.183, 72.381),
    ("C", 55.183, 71.151, 55.138, 69.931, 55.059, 68.721),
    ("L", 55.059, 0.000),
    ("Z",),
]

# ---------------- MID RECTANGLE (mm) ----------------
# Narrow black patch halfway between the robot front tip and the first
# full-width band, covering 2/3 of the free space, as wide as the robot.
MID_FRAC  = 2.0 / 3.0
_GAP_A    = ROBOT_START + ROBOT_LEN   # robot front tip
_GAP_B    = FIRST                     # first full-width band
MID_T     = (_GAP_B - _GAP_A) * MID_FRAC
MID_S     = (_GAP_A + _GAP_B) / 2.0 - MID_T / 2.0
MID_W     = ROBOT_W

# Shapes: (start, thickness, width). Width < W is centred in the corridor.
BANDS = [(FIRST + i * PITCH, BAND_T, W) for i in range(N_BANDS)]
MID   = (MID_S, MID_T, MID_W)
SHAPES = [MID] + BANDS

# ---------------- TILING PARAMETERS ----------------
TILE      = 155.0         # length each sheet owns
OVERLAP   = 15.0          # extra printed overlap flap
FLAP_BLEED = 1.0          # black bleed into the flap, hides a misaligned joint
N_TILES   = int(round(L / TILE))
MARGIN_B  = 20.0          # bottom page margin (trim area)
PRESCALE  = 1.0           # >1 pre-compensates a printer that shrinks the page

PW, PH = landscape(A4)    # 297 x 210 mm
X0 = (PW / mm - W) / 2.0  # 43.5 mm
GREY = HexColor("#9a9a9a")
LGREY = HexColor("#cccccc")


def draw_shapes(c, own_start, own_end, draw_end, y_base):
    """Draws the black shapes owned by this sheet.

    The overlap flap is hidden under the next sheet, so nothing is filled
    there except a small bleed that hides a slightly misaligned joint.
    """
    ink_end = min(own_end + FLAP_BLEED, draw_end)
    c.setFillColor(black)
    for s, t, w in SHAPES:
        a, b = max(s, own_start), min(s + t, ink_end)
        if b > a:
            c.rect((X0 + (W - w) / 2.0) * mm, (y_base + (a - own_start)) * mm,
                   w * mm, (b - a) * mm, stroke=0, fill=1)


def draw_robot(c, own_start, draw_end, y_base):
    """Dashed robot footprint, clipped to the portion owned by this sheet."""
    top = ROBOT_START + ROBOT_LEN
    if top <= own_start or ROBOT_START >= draw_end:
        return
    c.saveState()
    clip = c.beginPath()
    clip.rect(X0 * mm, y_base * mm, W * mm, (draw_end - own_start) * mm)
    c.clipPath(clip, stroke=0, fill=0)

    def X(dx):
        return (X0 + W / 2.0 + dx) * mm

    def Y(dy):
        return (y_base + ROBOT_START + dy - own_start) * mm

    p = c.beginPath()
    for seg in ROBOT_PATH:
        k = seg[0]
        if k == "M":
            p.moveTo(X(seg[1]), Y(seg[2]))
        elif k == "L":
            p.lineTo(X(seg[1]), Y(seg[2]))
        elif k == "C":
            p.curveTo(X(seg[1]), Y(seg[2]), X(seg[3]), Y(seg[4]),
                      X(seg[5]), Y(seg[6]))
        else:
            p.close()
    c.setStrokeColor(black)
    c.setLineWidth(0.25 * mm)
    c.setDash(ROBOT_DASH * mm, ROBOT_DASH * mm)
    c.drawPath(p, stroke=1, fill=0)

    dx, dy, r = ROBOT_MARK
    c.circle(X(dx), Y(dy), r * mm, stroke=1, fill=0)
    c.setDash()
    c.restoreState()


def cross(c, x, y, r=3.0):
    c.setLineWidth(0.4)
    c.setStrokeColor(black)
    c.line((x - r) * mm, y * mm, (x + r) * mm, y * mm)
    c.line(x * mm, (y - r) * mm, x * mm, (y + r) * mm)


def ruler(c, x, y0, length=100.0):
    """Vertical ruler for print-scale verification."""
    c.setStrokeColor(black)
    c.setLineWidth(0.6)
    c.line(x * mm, y0 * mm, x * mm, (y0 + length) * mm)
    for i in range(0, int(length) + 1, 10):
        w = 4.0 if i % 50 == 0 else 2.5
        c.line(x * mm, (y0 + i) * mm, (x + w) * mm, (y0 + i) * mm)
    c.saveState()
    c.translate((x - 2.5) * mm, y0 * mm)
    c.rotate(90)
    c.setFont("Helvetica", 6)
    c.drawString(0, 0, "exactly 100 mm = correct scale")
    c.restoreState()


def tile_page(c, i):
    if PRESCALE != 1.0:
        c.saveState()
        c.translate(PW / 2.0, PH / 2.0)
        c.scale(PRESCALE, PRESCALE)
        c.translate(-PW / 2.0, -PH / 2.0)
    _tile_body(c, i)
    if PRESCALE != 1.0:
        c.restoreState()
        c.setFont("Helvetica-Bold", 7)
        c.setFillColor(black)
        c.drawCentredString(PW / 2.0, (PH / mm - 7) * mm,
                            "PRE-SCALED TO %.1f%% - use this file ONLY if your printer shrinks pages to %.0f%%"
                            % (PRESCALE * 100.0, 100.0 / PRESCALE))


def _tile_body(c, i):
    own_start = i * TILE
    own_end = min(own_start + TILE, L)
    draw_end = min(own_end + OVERLAP, L)
    y_base = MARGIN_B

    # white arena floor
    c.setFillColor(white)
    c.setStrokeColor(white)
    c.rect(X0 * mm, y_base * mm, W * mm, (draw_end - own_start) * mm, stroke=0, fill=1)

    draw_shapes(c, own_start, own_end, draw_end, y_base)
    draw_robot(c, own_start, draw_end, y_base)

    # corridor side edges (width trim guide)
    c.setStrokeColor(GREY)
    c.setLineWidth(0.4)
    c.setDash(3, 3)
    for x in (X0, X0 + W):
        c.line(x * mm, (y_base - 6) * mm, x * mm, (y_base + (draw_end - own_start) + 6) * mm)
    c.setDash()

    # bottom trim line (sheet joining edge)
    c.setStrokeColor(black)
    c.setLineWidth(0.7)
    c.line(12 * mm, y_base * mm, (PW / mm - 12) * mm, y_base * mm)
    c.setFont("Helvetica-Bold", 7)
    c.setFillColor(black)
    label = "CUT HERE  ---  edge at %.1f cm from START" % (own_start / 10.0)
    if own_start <= 1e-6:
        label = "START (0 cm)  ---  PLACE WALL HERE"
    c.drawCentredString((PW / 2), (y_base - 5) * mm, label)
    cross(c, X0, y_base)
    cross(c, X0 + W, y_base)

    # overlap zone
    if draw_end > own_end:
        yo = y_base + (own_end - own_start)
        c.setStrokeColor(GREY)
        c.setLineWidth(0.5)
        c.setDash(2, 2)
        c.line(X0 * mm, yo * mm, (X0 + W) * mm, yo * mm)
        c.setDash()
        cross(c, X0, yo)
        cross(c, X0 + W, yo)
        c.setFillColor(GREY)
        c.setFont("Helvetica", 6.5)
        c.drawString((X0 + 2) * mm, (yo + 2) * mm,
                     "overlap flap: lay sheet %d on top of this area" % (i + 2))

    # end-of-path trim line (last sheet only), joining the two dashed edges
    if draw_end >= L - 1e-6:
        ye = y_base + (L - own_start)
        c.setStrokeColor(black)
        c.setLineWidth(0.7)
        c.line(X0 * mm, ye * mm, (X0 + W) * mm, ye * mm)
        cross(c, X0, ye)
        cross(c, X0 + W, ye)
        c.setFillColor(black)
        c.setFont("Helvetica-Bold", 7)
        c.drawCentredString((X0 + W / 2.0) * mm, (ye + 2.5) * mm,
                            "END (%.1f cm)" % (L / 10.0))

    # side wall label, right edge only, on every sheet
    yc = y_base + (draw_end - own_start) / 2.0
    for x, side in ((259.0, "RIGHT"),):
        c.saveState()
        c.translate(x * mm, yc * mm)
        c.rotate(90)
        c.setFont("Helvetica-Bold", 7)
        c.setFillColor(black)
        c.drawCentredString(0, 0, "PLACE %s WALL HERE" % side)
        c.restoreState()

    # right-hand side label
    c.saveState()
    c.translate((PW / mm - 14) * mm, (PH / mm / 2) * mm)
    c.rotate(90)
    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 10)
    c.drawCentredString(0, 0, "SHEET %d / %d   -   %.1f - %.1f cm from START" %
                        (i + 1, N_TILES, own_start / 10.0, own_end / 10.0))
    c.restoreState()

    # "towards START" arrow on the left
    c.saveState()
    c.translate(12 * mm, (PH / mm / 2 + 40) * mm)
    c.rotate(90)
    c.setFont("Helvetica", 8)
    c.setFillColor(GREY)
    c.drawCentredString(0, 0, "<<< towards START")
    c.restoreState()

    ruler(c, 26.0, 45.0)

    c.setFont("Helvetica", 6)
    c.setFillColor(GREY)
    c.drawString(14 * mm, 12 * mm,
                 "Print LANDSCAPE at 100%% scale (no \"fit to page\").  Arena %.0f x %.1f cm  -  page %d/%d"
                 % (W / 10.0, L / 10.0, i + 2, N_TILES + 1))


def schema(c, x, y, h):
    """Small dimensioned schematic of the arena, h mm tall."""
    k = h / L
    w = W * k
    c.setFillColor(white)
    c.setStrokeColor(black)
    c.setLineWidth(0.6)
    c.rect(x * mm, y * mm, w * mm, h * mm, stroke=1, fill=1)
    c.setFillColor(black)
    for s, t, sw in SHAPES:
        c.rect((x + (W - sw) / 2.0 * k) * mm, (y + s * k) * mm,
               (sw * k) * mm, (t * k) * mm, stroke=0, fill=1)

    # robot footprint, schematic
    c.setStrokeColor(GREY)
    c.setLineWidth(0.4)
    c.setDash(1.2, 1.2)
    c.rect((x + (W - ROBOT_W) / 2.0 * k) * mm, (y + ROBOT_START * k) * mm,
           (ROBOT_W * k) * mm, (ROBOT_LEN * k) * mm, stroke=1, fill=0)
    c.setDash()

    c.setFont("Helvetica", 6.5)
    c.setFillColor(black)
    c.drawCentredString((x + w / 2) * mm, (y - 4) * mm, "START (%.0f cm wide)" % (W / 10.0))
    quotes = [(0.0, ""), (ROBOT_START + ROBOT_LEN, ""),
              (MID_S, ""), (MID_S + MID_T, "")]
    quotes += [(FIRST + i * PITCH, "") for i in range(N_BANDS)]
    quotes += [(L, "")]
    quotes = [(pos, "%.1f" % (pos / 10.0)) for pos, _ in quotes]
    for pos, lab in quotes:
        yy = y + pos * k
        c.setStrokeColor(GREY)
        c.setLineWidth(0.3)
        c.line((x + w + 1) * mm, yy * mm, (x + w + 5) * mm, yy * mm)
        c.setFillColor(black)
        c.drawString((x + w + 6) * mm, (yy - 1) * mm, lab + " cm")


def cover(c):
    c.setPageSize(A4)
    w, h = A4[0] / mm, A4[1] / mm
    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(20 * mm, (h - 22) * mm, "Calibration arena %.0f x %.1f cm" % (W / 10.0, L / 10.0))
    c.setFont("Helvetica", 9)
    c.drawString(20 * mm, (h - 29) * mm, "Print on %d landscape A4 sheets and join them with tape." % N_TILES)

    schema(c, 20, 40, 210)

    tx = 95
    ty = h - 40
    lines = [
        ("Helvetica-Bold", 10, "1. Print settings"),
        ("Helvetica", 8.5, "LANDSCAPE orientation, 100% scale."),
        ("Helvetica", 8.5, "Turn off \"fit to page\" / \"shrink oversized pages\"."),
        ("Helvetica", 8.5, "Check the ruler printed on every sheet: it must measure"),
        ("Helvetica", 8.5, "exactly 100 mm."),
        ("", 4, ""),
        ("Helvetica-Bold", 10, "2. Preparation"),
        ("Helvetica", 8.5, "Trim each sheet along the solid line at the bottom."),
        ("Helvetica", 8.5, "Do not trim the top edge: that 1.5 cm flap is the overlap."),
        ("Helvetica", 8.5, "The vertical dashed lines mark the corridor edges"),
        ("Helvetica", 8.5, "(21 cm): trim there if you need the exact width."),
        ("", 4, ""),
        ("Helvetica-Bold", 10, "3. Assembly"),
        ("Helvetica", 8.5, "Start from sheet 1 (START) and work upwards in order."),
        ("Helvetica", 8.5, "Lay the trimmed edge of sheet n+1 onto the horizontal"),
        ("Helvetica", 8.5, "dashed line of sheet n, matching the registration"),
        ("Helvetica", 8.5, "crosses on both sides."),
        ("Helvetica", 8.5, "Tape from the back; on the front use matte tape only,"),
        ("Helvetica", 8.5, "to avoid specular reflections."),
        ("Helvetica", 8.5, "Black areas stop at the fold line on purpose: the flap is"),
        ("Helvetica", 8.5, "hidden by the next sheet, which carries the rest."),
        ("", 4, ""),
        ("Helvetica-Bold", 10, "4. Walls"),
        ("Helvetica", 8.5, "Only two walls are needed, marked by the \"PLACE WALL"),
        ("Helvetica", 8.5, "HERE\" labels: the long RIGHT side, and the one across"),
        ("Helvetica", 8.5, "the START line. The left side and the %.1f cm end are" % (L / 10.0)),
        ("Helvetica", 8.5, "left open."),
        ("Helvetica", 8.5, "Walls sit ON the line, outside the floor, so the clear"),
        ("Helvetica", 8.5, "inner width stays exactly 21 cm."),
        ("Helvetica", 8.5, "They must be WHITE and MATTE, like the floor, so they do"),
        ("Helvetica", 8.5, "not alter the readings of the reflective sensors."),
        ("", 4, ""),
        ("Helvetica-Bold", 10, "5. Robot start position"),
        ("Helvetica", 8.5, "The dashed outline on sheet 1 is the robot footprint."),
        ("Helvetica", 8.5, "Before every run, push the robot BACKWARDS until its"),
        ("Helvetica", 8.5, "rear touches the START wall, so the rear edge sits on"),
        ("Helvetica", 8.5, "the START line, and centre it inside the outline."),
        ("Helvetica", 8.5, "That contact, not the outline, sets the zero of the run."),
        ("", 4, ""),
        ("Helvetica-Bold", 10, "6. Note on the black areas"),
        ("Helvetica", 8.5, "Laser black is often glossy. Alternatively print the"),
        ("Helvetica", 8.5, "outlines only and fill them with matte black electrical"),
        ("Helvetica", 8.5, "tape, which is more uniform for reflective sensors."),
        ("", 6, ""),
        ("Helvetica-Bold", 9, "Dimensions used"),
        ("Helvetica", 8, "width %.0f cm - total length %.1f cm" % (W / 10.0, L / 10.0)),
        ("Helvetica", 8, "robot footprint: %.1f cm long, %.1f cm wide, rear at START"
            % (ROBOT_LEN / 10.0, ROBOT_W / 10.0)),
        ("Helvetica", 8, "narrow patch: %.1f cm thick, %.1f cm wide, from %.1f to %.1f cm"
            % (MID_T / 10.0, MID_W / 10.0, MID_S / 10.0, (MID_S + MID_T) / 10.0)),
        ("Helvetica", 8, "START -> first full-width band: 23 cm"),
        ("Helvetica", 8, "black bands: %.1f cm thick, %.0f cm pitch (edge to edge), %d of them"
            % (BAND_T / 10.0, PITCH / 10.0, N_BANDS)),
        ("Helvetica", 8, "last band ends %.1f cm before the END line"
            % ((L - (FIRST + (N_BANDS - 1) * PITCH + BAND_T)) / 10.0)),
    ]
    for font, size, text in lines:
        if font:
            c.setFont(font, size)
            c.drawString(tx * mm, ty * mm, text)
        ty -= size * 0.42 + 1.35

    c.showPage()
    c.setPageSize(landscape(A4))


def main(path="/mnt/user-data/outputs/arena-A4.pdf", prescale=1.0):
    global PRESCALE
    PRESCALE = prescale
    c = canvas.Canvas(path, pagesize=landscape(A4))
    c.setTitle("Calibration arena %.0fx%.1f cm - A4 tiles" % (W / 10.0, L / 10.0))
    cover(c)
    for i in range(N_TILES):
        tile_page(c, i)
        c.showPage()
    c.save()
    print("OK:", path, "-", N_TILES + 1, "pages")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        main(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 1.0)
    else:
        main()
