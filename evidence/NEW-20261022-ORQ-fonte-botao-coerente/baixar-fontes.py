"""Baixa as fontes candidatas (Google Fonts, OFL) em TTF, só os glifos de "ESSE SOU EU! SELECIONAR".

uso: python -I baixar-fontes.py <pasta-destino>
"""
import json, re, sys, urllib.parse, urllib.request
from pathlib import Path

CANDIDATAS = [
    ("Lilita One", 400), ("Titan One", 400), ("Luckiest Guy", 400), ("Bowlby One", 400),
    ("Bowlby One SC", 400), ("Baloo 2", 800), ("Fredoka", 700), ("Rubik", 900), ("Rubik", 800),
    ("Chewy", 400), ("Bangers", 400), ("Passion One", 700), ("Passion One", 900), ("Paytone One", 400),
    ("Sniglet", 800), ("Dela Gothic One", 400), ("Rammetto One", 400), ("Changa One", 400),
    ("Londrina Solid", 900), ("Bungee", 400), ("Rowdies", 700), ("Chango", 400), ("Carter One", 400),
    ("Nunito", 900), ("Mochiy Pop One", 400), ("Archivo Black", 400), ("Sigmar One", 400),
    ("Coiny", 400), ("Grandstander", 900), ("Concert One", 400), ("Baloo Bhai 2", 800),
    ("Lexend", 900), ("Poppins", 900), ("Montserrat", 900), ("Shrikhand", 400), ("Gluten", 900),
]
TEXTO = "ESSE SOU EU! SELECIONAR"
UA = "Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.30 (KHTML, like Gecko) Safari/534.30"  # devolve TTF


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def main(dest):
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    lista = []
    for fam, w in CANDIDATAS:
        q = urllib.parse.quote_plus(fam) + (f":wght@{w}" if w != 400 else "")
        url = f"https://fonts.googleapis.com/css2?family={q}&text={urllib.parse.quote(TEXTO)}"
        try:
            css = get(url).decode()
            src = re.search(r"src:\s*url\(([^)]+)\)", css).group(1)
            nome = f"{fam.replace(' ', '-')}-{w}.ttf"
            (dest / nome).write_bytes(get(src))
            lista.append({"familia": fam, "peso": w, "arquivo": nome})
            print("ok", fam, w)
        except Exception as e:  # noqa: BLE001
            print("FALHOU", fam, w, e)
    (dest / "lista.json").write_text(json.dumps(lista, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1])
