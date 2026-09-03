#!/usr/bin/env python3
"""자막 카드형 숏폼(9:16) 렌더러.

scenes JSON 을 받아 1080x1920 mp4 를 만든다. 촬영 없이 만들 수 있는 v0 용도이고,
사장님 촬영분·나레이션·음악은 편집 단계에서 얹는다.

사용법:
    python3 render.py scenes/w1-e1.json out/w1-e1.mp4

필요 조건:
    - Pillow (설치되어 있음)
    - ffmpeg 바이너리. 없으면 `npm i ffmpeg-static` 후 FFMPEG 환경변수로 경로 지정.
"""

import json
import os
import shutil
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1080, 1920, 30

FONT_BOLD = ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 1)
FONT_REG = ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 1)

BG = (11, 18, 32)
BG_DISCLAIMER = (0, 0, 0)
FG = (245, 248, 255)
MUTED = (150, 163, 187)
ACCENT = (79, 140, 255)
WARN = (255, 107, 107)

# --- punchy 스타일 팔레트 -------------------------------------------------
# 컷이 짧아 배경색 자체가 전환 신호로 쓰인다. 톤을 바꿔 가며 리듬을 만든다.
P_TONE = {
    "dark": (12, 16, 30),
    "red": (156, 26, 36),
    "blue": (22, 62, 158),
    "black": (0, 0, 0),
}
P_HILITE = (255, 214, 10)   # 형광 노랑 하이라이트
P_INK = (14, 14, 14)        # 하이라이트 위 글자
P_WHITE = (255, 255, 255)

_font_cache = {}


def font(spec, size):
    key = (spec, size)
    if key not in _font_cache:
        path, index = spec
        _font_cache[key] = ImageFont.truetype(path, size, index=index)
    return _font_cache[key]


def ffmpeg_bin():
    env = os.environ.get("FFMPEG")
    if env and os.path.exists(env):
        return env
    found = shutil.which("ffmpeg")
    if found:
        return found
    # npm ffmpeg-static 이 프로젝트 안에 있으면 사용
    for root in (os.getcwd(), os.path.dirname(os.path.abspath(__file__))):
        cand = os.path.join(root, "node_modules", "ffmpeg-static", "ffmpeg")
        if os.path.exists(cand):
            return cand
    raise SystemExit("ffmpeg 를 찾지 못했습니다. FFMPEG 환경변수로 경로를 지정하세요.")


def ease_out(x):
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x) ** 3


def wrap(draw, text, fnt, max_w):
    """한글 기준 글자 단위 줄바꿈. 어절을 우선 유지한다."""
    words = text.split(" ")
    lines, cur = [], ""
    for word in words:
        trial = word if not cur else cur + " " + word
        if draw.textlength(trial, font=fnt) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def draw_progress(draw, ratio):
    y = 26
    draw.rounded_rectangle([60, y, W - 60, y + 8], 4, fill=(35, 46, 68))
    end = 60 + int((W - 120) * max(0.0, min(1.0, ratio)))
    if end > 64:
        draw.rounded_rectangle([60, y, end, y + 8], 4, fill=ACCENT)


def blend(c1, c2, t):
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


def render_frame(scene, t, progress):
    """scene 한 컷의 t초 시점 프레임을 그린다."""
    kind = scene.get("kind", "point")
    bg = BG_DISCLAIMER if kind == "disclaimer" else BG
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)

    if kind != "disclaimer":
        # 배경 악센트: 위쪽 은은한 밴드
        for i in range(220):
            a = i / 220
            d.line([(0, i), (W, i)], fill=blend((17, 27, 47), bg, a))
        draw_progress(d, progress)

    accent = WARN if kind in ("hook", "disclaimer") else ACCENT
    cy = H // 2

    # 1) 키커
    kicker = scene.get("kicker")
    ky = cy - 380
    if kicker:
        f = font(FONT_BOLD, 40)
        a = ease_out(t / 0.30)
        tw = d.textlength(kicker, font=f)
        x0 = (W - tw) / 2
        pad = 26
        box = [x0 - pad, ky - 16, x0 + tw + pad, ky + 62]
        d.rounded_rectangle(box, 18, fill=blend(bg, accent, 0.18 * a))
        d.text((x0, ky), kicker, font=f, fill=blend(bg, accent, a))

    # 2) 헤드라인 (여러 줄, 순차 등장)
    head = scene.get("headline", [])
    size = scene.get("headline_size", 92 if kind != "disclaimer" else 58)
    f = font(FONT_BOLD, size)
    lines = []
    for raw in head:
        lines.extend(wrap(d, raw, f, W - 150))
    line_h = int(size * 1.42)
    total = line_h * len(lines)
    y = cy - total // 2 - (20 if kicker else 0)
    for i, line in enumerate(lines):
        p = ease_out((t - 0.10 * i) / 0.34)
        if p <= 0:
            continue
        color = blend(bg, WARN if scene.get("emphasis") == i else FG, p)
        dy = int((1 - p) * 34)
        d.text(((W - d.textlength(line, font=f)) / 2, y + i * line_h + dy), line, font=f, fill=color)

    # 3) 보조 문구
    sub = scene.get("sub", [])
    if sub:
        fs = font(FONT_REG, scene.get("sub_size", 46))
        sl = []
        for raw in sub:
            sl.extend(wrap(d, raw, fs, W - 200))
        sy = y + total + 56
        for i, line in enumerate(sl):
            p = ease_out((t - 0.30 - 0.10 * i) / 0.34)
            if p <= 0:
                continue
            d.text(((W - d.textlength(line, font=fs)) / 2, sy + i * int(46 * 1.5)),
                   line, font=fs, fill=blend(bg, MUTED, p))

    # 4) 하단 고정 브랜드/CTA 줄
    footer = scene.get("footer")
    if footer:
        ff = font(FONT_BOLD, 44)
        p = ease_out((t - 0.25) / 0.4)
        if p > 0:
            tw = d.textlength(footer, font=ff)
            x0 = (W - tw) / 2
            d.rounded_rectangle([x0 - 40, H - 300, x0 + tw + 40, H - 300 + 104], 52,
                                fill=blend(bg, ACCENT, 0.9 * p))
            d.text((x0, H - 300 + 24), footer, font=ff, fill=blend(bg, (255, 255, 255), p))

    note = scene.get("note")
    if note:
        nf = font(FONT_REG, 34)
        d.text(((W - d.textlength(note, font=nf)) / 2, H - 150), note, font=nf, fill=MUTED)

    # 5) 컷 전환용 페이드 인/아웃
    fade_in, fade_out = 0.16, 0.16
    dur = scene["dur"]
    k = 1.0
    if t < fade_in:
        k = t / fade_in
    elif t > dur - fade_out:
        k = max(0.0, (dur - t) / fade_out)
    if k < 1.0:
        img = Image.blend(Image.new("RGB", (W, H), (0, 0, 0)), img, k)
    return img


def draw_progress_punchy(draw, ratio, bg):
    """상단 진행바. 컷이 짧아 잔여 길이를 계속 보여 줘야 이탈이 준다.

    트랙은 배경을 어둡게 깐 색이어야 한다. 밝은 색을 깔면 배경색이 바뀌는 컷에서
    막대가 항상 꽉 찬 것처럼 보여 "거의 끝났다"는 반대 신호를 준다.
    """
    draw.rectangle([0, 0, W, 12], fill=blend(bg, (0, 0, 0), 0.45))
    draw.rectangle([0, 0, int(W * max(0.0, min(1.0, ratio))), 12], fill=P_HILITE)


def render_frame_punchy(scene, t, progress):
    """빠른 컷·큰 글씨·하드컷 스타일. 페이드 대신 등장 모션으로 리듬을 만든다."""
    kind = scene.get("kind", "point")
    tone = scene.get("tone", "black" if kind == "disclaimer" else "dark")
    bg = P_TONE.get(tone, P_TONE["dark"])
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)

    if kind != "disclaimer":
        draw_progress_punchy(d, progress, bg)

    cy = H // 2

    # 1) 키커 — 작은 라벨. 헤드라인이 커진 만큼 존재감을 낮춘다.
    kicker = scene.get("kicker")
    if kicker:
        f = font(FONT_BOLD, 42)
        a = ease_out(t / 0.12)
        tw = d.textlength(kicker, font=f)
        x0 = (W - tw) / 2
        ky = 300
        d.rounded_rectangle([x0 - 30, ky - 14, x0 + tw + 30, ky + 62], 40,
                            fill=blend(bg, P_WHITE, 0.16 * a))
        d.text((x0, ky), kicker, font=f, fill=blend(bg, P_WHITE, 0.92 * a))

    # 2) 헤드라인 — 줄을 한꺼번에 올린다. 줄마다 지연을 주면 컷이 느리게 읽힌다.
    head = scene.get("headline", [])
    size = scene.get("headline_size", 130 if kind != "disclaimer" else 62)
    f = font(FONT_BOLD, size)
    lines = []
    for raw in head:
        lines.extend(wrap(d, raw, f, W - 110))
    line_h = int(size * 1.30)
    total = line_h * len(lines)
    y = cy - total // 2 - (30 if kicker else 0)

    emphasis = scene.get("emphasis")
    if isinstance(emphasis, int):
        emphasis = [emphasis]
    emphasis = set(emphasis or [])

    p = ease_out(t / 0.14)
    dy = int((1 - p) * 26)
    for i, line in enumerate(lines):
        lw = d.textlength(line, font=f)
        lx = (W - lw) / 2
        ly = y + i * line_h + dy
        if i in emphasis:
            # 형광 하이라이트가 가로로 밀려 들어오고, 덮인 구간의 글자는 검정으로 뒤집힌다.
            # 컷당 한 줄만 쓴다 — 두 줄에 걸면 시선이 갈라져 효과가 죽는다.
            wipe = ease_out((t - 0.08) / 0.20)
            pad_x, pad_t, pad_b = 26, int(size * 0.10), int(size * 0.26)
            x_end = int(lx - pad_x + (lw + pad_x * 2) * max(0.0, wipe))
            if wipe > 0:
                d.rectangle([lx - pad_x, ly - pad_t, x_end, ly + size + pad_b], fill=P_HILITE)
            d.text((lx, ly), line, font=f, fill=blend(bg, P_WHITE, p))
            if wipe > 0:
                ink = Image.new("RGB", (W, H), P_INK)
                mask = Image.new("L", (W, H), 0)
                ImageDraw.Draw(mask).text((lx, ly), line, font=f, fill=255)
                # 하이라이트 밖은 마스크를 지워 흰 글자를 남긴다.
                ImageDraw.Draw(mask).rectangle([x_end, 0, W, H], fill=0)
                img.paste(ink, (0, 0), mask)
                d = ImageDraw.Draw(img)
        else:
            d.text((lx, ly), line, font=f, fill=blend(bg, P_WHITE, p))

    # 3) 보조 문구 — 컷이 짧으므로 한 줄만 권장한다.
    sub = scene.get("sub", [])
    if sub:
        fs = font(FONT_REG, scene.get("sub_size", 48))
        sl = []
        for raw in sub:
            sl.extend(wrap(d, raw, fs, W - 160))
        sy = y + total + 54
        ps = ease_out((t - 0.10) / 0.18)
        if ps > 0:
            for i, line in enumerate(sl):
                d.text(((W - d.textlength(line, font=fs)) / 2, sy + i * int(48 * 1.45)),
                       line, font=fs, fill=blend(bg, P_WHITE, 0.78 * ps))

    # 4) CTA 버튼
    footer = scene.get("footer")
    if footer:
        ff = font(FONT_BOLD, 50)
        pf = ease_out((t - 0.12) / 0.22)
        if pf > 0:
            tw = d.textlength(footer, font=ff)
            x0 = (W - tw) / 2
            d.rounded_rectangle([x0 - 48, H - 330, x0 + tw + 48, H - 330 + 120], 60,
                                fill=blend(bg, P_HILITE, pf))
            d.text((x0, H - 330 + 32), footer, font=ff, fill=blend(bg, P_INK, pf))

    note = scene.get("note")
    if note:
        nf = font(FONT_REG, 36)
        d.text(((W - d.textlength(note, font=nf)) / 2, H - 160), note,
               font=nf, fill=blend(bg, P_WHITE, 0.6))

    return img


def main():
    if len(sys.argv) < 3:
        raise SystemExit("사용법: render.py <scenes.json> <out.mp4>")
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    out = sys.argv[2]
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)

    scenes = spec["scenes"]
    style = spec.get("style", "calm")
    frame_fn = render_frame_punchy if style == "punchy" else render_frame
    total_dur = sum(s["dur"] for s in scenes)
    total_frames = int(round(total_dur * FPS))

    # punchy 는 편집에서 음악을 얹는 것을 전제로 한다. 컷 길이가 비트 격자에서
    # 벗어나면 어떤 곡을 깔아도 컷과 박자가 어긋나므로 렌더 전에 막는다.
    if style == "punchy":
        beat = 60.0 / spec.get("bpm", 120) * spec.get("beats_per_cut_unit", 1)
        off = [s for s in scenes if abs(round(s["dur"] / beat) - s["dur"] / beat) > 1e-6]
        if off:
            raise SystemExit(
                f"컷 길이가 비트 격자({beat:.3f}초)의 배수가 아닙니다: "
                + ", ".join(str(s["dur"]) for s in off))

    cmd = [
        ffmpeg_bin(), "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-shortest",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
        out,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

    idx, elapsed = 0, 0.0
    for n in range(total_frames):
        t_global = n / FPS
        while idx < len(scenes) - 1 and t_global >= elapsed + scenes[idx]["dur"]:
            elapsed += scenes[idx]["dur"]
            idx += 1
        frame = frame_fn(scenes[idx], t_global - elapsed, t_global / total_dur)
        proc.stdin.write(frame.tobytes())
        if n % 150 == 0:
            print(f"  {n}/{total_frames} 프레임", flush=True)

    proc.stdin.close()
    err = proc.stderr.read().decode("utf-8", "ignore")
    if proc.wait() != 0:
        raise SystemExit("ffmpeg 실패:\n" + err[-2000:])
    print(f"완료: {out} ({total_dur:.1f}초, {total_frames} 프레임)")


if __name__ == "__main__":
    main()
