#!/usr/bin/env python3
"""Rigenera le icone dell'app da design/icona-crm.jpeg.

    pip install Pillow
    python3 scripts/genera-icone.py

Il master è la tavola dell'icona così com'è stata disegnata: il riquadro nero
arrotondato su uno sfondo di presentazione, appena più scuro. Lo script ritaglia
il riquadro e butta via lo sfondo — dentro la maschera arrotondata di iOS quel
margine diventerebbe un secondo bordo intorno all'icona, e il disco finirebbe
più piccolo del necessario.

Da qui escono i quattro file dichiarati in app/manifest.ts:

  apple-touch-icon.png   180  l'icona che iOS salva sulla Home
  icon-192.png           192  Android e la scheda del browser
  favicon.png            512  manifest e scheda del browser
  icon-maskable-512.png  512  Android, che ritaglia dentro un cerchio

La maskable è l'unica trattata a parte: Android ritaglia le icone maskable in
un cerchio inscritto, e a piena pagina la scritta "CRM" in basso ci finirebbe
fuori. Il contenuto viene quindi rimpicciolito dentro la zona sicura, su un
fondo che continua la sfumatura del riquadro invece di tagliarlo di netto.
"""

from pathlib import Path

from PIL import Image

RADICE = Path(__file__).resolve().parent.parent
MASTER = RADICE / "design" / "icona-crm.jpeg"
PUBLIC = RADICE / "public"

# Quota del lato occupata dal contenuto nella versione maskable. Android
# garantisce solo il cerchio inscritto nell'80% centrale: sotto quella soglia
# la scritta "CRM" resta dentro anche sui lanciatori che ritagliano di più.
QUOTA_MASKABLE = 0.78

# Salto di luminosità che segna il bordo chiaro del riquadro rispetto allo
# sfondo della tavola: il ritaglio si cerca da solo, così un master ridisegnato
# con margini diversi non costringe a rimisurare a mano.
SALTO_BORDO = 20


def bordi(immagine: Image.Image) -> tuple[int, int, int, int]:
    """Riquadro dell'icona dentro la tavola, come (sinistra, alto, destra, basso)."""
    grigi = immagine.convert("L")
    larghezza, altezza = grigi.size
    px = grigi.load()

    def primo_salto(valori: list[int]) -> int:
        for i in range(1, len(valori)):
            if valori[i] - valori[i - 1] >= SALTO_BORDO:
                return i - 1
        raise SystemExit("Bordo del riquadro non trovato: il master non ha la cornice attesa.")

    riga = [px[x, altezza // 2] for x in range(larghezza)]
    colonna = [px[larghezza // 2, y] for y in range(altezza)]

    sinistra = primo_salto(riga)
    destra = larghezza - 1 - primo_salto(riga[::-1])
    alto = primo_salto(colonna)
    basso = altezza - 1 - primo_salto(colonna[::-1])
    return sinistra, alto, destra, basso


def quadra(riquadro: tuple[int, int, int, int], limite: tuple[int, int]) -> tuple[int, int, int, int]:
    """Allarga il riquadro al quadrato che lo contiene, restando dentro la tavola."""
    sinistra, alto, destra, basso = riquadro
    lato = max(destra - sinistra, basso - alto)
    cx, cy = (sinistra + destra) / 2, (alto + basso) / 2
    mezzo = lato / 2
    x0 = max(0, min(round(cx - mezzo), limite[0] - lato))
    y0 = max(0, min(round(cy - mezzo), limite[1] - lato))
    return x0, y0, x0 + lato, y0 + lato


def sfumatura(icona: Image.Image, lato: int) -> Image.Image:
    """Fondo della maskable: la stessa sfumatura verticale del riquadro, estesa.

    Un fondo nero piatto stacca sul riquadro, che verso il basso schiarisce
    appena: sul cerchio ritagliato da Android il salto si vedrebbe.

    Il campione si prende da una striscia del margine sinistro, dove c'è solo
    il nero del riquadro. Mediando l'immagine intera il disco metallico
    entrerebbe nella media e il fondo uscirebbe a bande chiare.
    """
    larghezza, altezza = icona.size
    striscia = icona.crop((round(larghezza * 0.02), 0, round(larghezza * 0.08), altezza))
    return striscia.resize((1, lato), Image.LANCZOS).resize((lato, lato), Image.NEAREST)


def main() -> None:
    if not MASTER.exists():
        raise SystemExit(f"Master mancante: {MASTER}")

    tavola = Image.open(MASTER).convert("RGB")
    riquadro = quadra(bordi(tavola), tavola.size)
    icona = tavola.crop(riquadro)
    print(f"Master {tavola.size[0]}x{tavola.size[1]} → riquadro {riquadro}, lato {icona.size[0]}px")

    piena = icona.resize((512, 512), Image.LANCZOS)
    for nome, lato in [("favicon.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)]:
        (piena if lato == 512 else icona.resize((lato, lato), Image.LANCZOS)).save(
            PUBLIC / nome, "PNG", optimize=True
        )
        print(f"  {nome} {lato}x{lato}")

    lato_contenuto = round(512 * QUOTA_MASKABLE)
    maskable = sfumatura(piena, 512)
    contenuto = icona.resize((lato_contenuto, lato_contenuto), Image.LANCZOS)
    scarto = (512 - lato_contenuto) // 2
    maskable.paste(contenuto, (scarto, scarto))
    maskable.save(PUBLIC / "icon-maskable-512.png", "PNG", optimize=True)
    print(f"  icon-maskable-512.png 512x512 (contenuto al {round(QUOTA_MASKABLE * 100)}%)")


if __name__ == "__main__":
    main()
