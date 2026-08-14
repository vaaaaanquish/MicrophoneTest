#!/usr/bin/env python3
"""Build-time generator for the share landing pages under /s/{lang}/{score}/.

X's crawler does not run JavaScript, and GitHub Pages cannot vary a response by
query string, so a shared link can only show a card if that exact path serves
static HTML whose og:image already exists. One page per overall score is the
most that can be enumerated (see tools/generate-og-cards.js for the images).

Usage:  python3 tools/generate-og-pages.py
"""

import html
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://vaaaaanquish.github.io/MicrophoneTest"

RATINGS = ["excellent", "good", "fair", "poor"]

LABEL = {
    "ja": {
        "excellent": "Excellent!!",
        "good": "So Good!",
        "fair": "もう一歩！",
        "poor": "のびしろあり…",
    },
    "en": {
        "excellent": "Excellent!!",
        "good": "So Good!",
        "fair": "Almost there",
        "poor": "Needs work…",
    },
}

EMOJI = {"excellent": "🎉", "good": "🎉", "fair": "💪", "poor": "🌱"}

TEXT = {
    "ja": {
        "desc": "マイクの音質スコアは {score}/100（{verdict}）でした。ノイズ・反響・録音レベルなど9項目を、文献ベースの指標でブラウザだけで測れます。",
        "cta": "自分のマイクも測ってみる",
        "lead": "この結果は Microphone Test で測定されました。",
    },
    "en": {
        "desc": "My microphone quality score: {score}/100 ({verdict}). Measure noise, reverb, level and six more metrics right in your browser.",
        "cta": "Test your own microphone",
        "lead": "This result was measured with Microphone Test.",
    },
}


def rating_for(score):
    if score >= 80:
        return "excellent"
    if score >= 60:
        return "good"
    if score >= 40:
        return "fair"
    return "poor"


PAGE = """<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Microphone Test">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{image}">
<link rel="icon" type="image/svg+xml" href="../../../icon.svg">
<style>
  body {{
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #0d0d0d; color: #fff; text-align: center;
    font-family: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif;
  }}
  .wrap {{ padding: 40px 24px; max-width: 720px; }}
  img {{ width: 100%; height: auto; border-radius: 16px; border: 1px solid rgba(255,255,255,.1); }}
  p {{ color: #c3c2b7; font-size: .95rem; line-height: 1.7; }}
  a.cta {{
    display: inline-block; margin-top: 8px; padding: 13px 28px; border-radius: 999px;
    background: #3987e5; color: #fff; text-decoration: none; font-weight: 600;
  }}
  a.cta:hover {{ background: #2a78d6; }}
</style>
</head>
<body>
  <div class="wrap">
    <img src="{image_rel}" alt="{title}" width="1200" height="630">
    <p>{lead}</p>
    <a class="cta" href="../../../">{cta} →</a>
  </div>
</body>
</html>
"""


def main():
    written = 0
    for lang in ("ja", "en"):
        for score in range(101):
            rating = rating_for(score)
            verdict = LABEL[lang][rating]
            title = f"Microphone Test — {score}/100 {verdict} {EMOJI[rating]}"
            desc = TEXT[lang]["desc"].format(score=score, verdict=verdict)
            url = f"{SITE}/s/{lang}/{score}/"
            image = f"{SITE}/s/{lang}/{score}.png"

            out_dir = os.path.join(BASE, "s", lang, str(score))
            os.makedirs(out_dir, exist_ok=True)
            with open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8") as f:
                f.write(
                    PAGE.format(
                        lang=lang,
                        title=html.escape(title, quote=True),
                        desc=html.escape(desc, quote=True),
                        url=url,
                        image=image,  # crawlers need an absolute URL
                        image_rel=f"../{score}.png",
                        lead=html.escape(TEXT[lang]["lead"]),
                        cta=html.escape(TEXT[lang]["cta"]),
                    )
                )
            written += 1
    print(f"{written} pages written")


if __name__ == "__main__":
    main()
