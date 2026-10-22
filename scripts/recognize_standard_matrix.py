"""Read checkmarks from a ruled standard table's rendered page image.

OCR supplies row labels only. Every matrix mark is detected from page pixels.
"""

import argparse
import json
from pathlib import Path

from PIL import Image

from reconstruct_standard_tables import horizontal_borders, reconstruct, vertical_borders


def unruled_rows(folder: Path, page_number: int, min_y=None, max_y=None):
    stem = f"page-{page_number:03d}"
    image = Image.open(folder / f"{stem}.png").convert("L")
    page = json.loads((folder / f"{stem}.json").read_text())
    borders = horizontal_borders(image)
    columns = vertical_borders(image, borders[0], borders[-1], 0, image.width - 1)
    if len(columns) != 7 or len(borders) < 3:
        raise ValueError(f"Page {page_number}: expected a five-column matrix")

    first_row = max(borders[1], min_y) if min_y is not None else borders[1]
    last_row = min(borders[-1], max_y) if max_y is not None else borders[-1]
    lines = sorted(
        (
            (round((1 - line["y"]) * image.height), round(line["x"] * image.width), line["text"])
            for line in page["lines"]
            if round(line["x"] * image.width) < columns[1] - 3
            and first_row + 5 < round((1 - line["y"]) * image.height) < last_row - 5
        ),
        key=lambda line: (line[0], line[1]),
    )
    rows = []
    for y, x, label in lines:
        if rows and abs(y - rows[-1][0]) <= 5:
            rows[-1][1].append((x, label))
        else:
            rows.append((y, [(x, label)]))

    centers = [(left + right) // 2 for left, right in zip(columns[1:-1], columns[2:])]
    result = []
    for y, parts in rows:
        label = " ".join(text for _, text in sorted(parts)).replace("|", "\\|")
        marks = []
        for x in centers:
            ink = sum(
                image.getpixel((x + dx, y + dy)) < 180
                for dx in range(-8, 9)
                for dy in range(-7, 8)
            )
            marks.append("*" if ink >= 7 else "")
        result.append((label, marks))
    return result


def marked_rows(folder: Path, page_number: int):
    stem = f"page-{page_number:03d}"
    image = Image.open(folder / f"{stem}.png")
    gray = image.convert("L")
    ocr = json.loads((folder / f"{stem}.json").read_text())
    table = next(table for table in reconstruct(ocr, image) if table["markdown"])
    labels = [line.split(" | ")[0].removeprefix("| ") for line in table["markdown"].splitlines()[2:]]

    borders = horizontal_borders(gray)
    columns = vertical_borders(gray, borders[0], borders[-1], 0, gray.width - 1)
    if len(columns) != 7 or len(labels) != len(borders) - 2:
        raise ValueError(f"Page {page_number}: labels and image grid do not align")

    centers = [(left + right) // 2 for left, right in zip(columns[1:-1], columns[2:])]
    result = []
    for label, top, bottom in zip(labels, borders[1:-1], borders[2:]):
        y = (top + bottom) // 2
        marks = []
        for x in centers:
            dark_pixels = sum(
                gray.getpixel((x + dx, y + dy)) < 180
                for dx in range(-15, 16)
                for dy in range(-15, 16)
            )
            marks.append("√" if dark_pixels >= 12 else "")
        result.append((label, marks))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("number", help="Standard stem, such as GB-T-20282-2006")
    parser.add_argument("pages", type=int, nargs="+", help="One-based PDF page numbers")
    parser.add_argument("--phases", action="store_true", help="Use the five engineering-phase column names")
    parser.add_argument("--unruled", action="store_true", help="Read rows without individual horizontal borders")
    parser.add_argument("--column-names", help="Comma-separated names for the five matrix columns")
    parser.add_argument("--output", type=Path, help="Write the generated Markdown table to a file")
    parser.add_argument("--append", action="store_true", help="Append rows without another table header")
    parser.add_argument("--min-y", type=int, help="Start row content at this image pixel")
    parser.add_argument("--max-y", type=int, help="End row content at this image pixel")
    parser.add_argument(
        "--ocr-directory", type=Path,
        default=Path("/tmp/feeicn-information-security-ocr-2x"),
    )
    args = parser.parse_args()
    folder = args.ocr_directory / args.number
    columns = ["起始", "设计", "建设", "运行和维护", "废弃"] if args.phases else [
        "第一级", "第二级", "第三级", "第四级", "第五级",
    ]
    if args.column_names:
        columns = args.column_names.split(",")
        if len(columns) != 5:
            parser.error("--column-names requires five comma-separated names")
    result = [] if args.append else [
        "| " + " | ".join(["安全工程要求", *columns]) + " |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for page in args.pages:
        rows = unruled_rows(folder, page, args.min_y, args.max_y) if args.unruled else marked_rows(folder, page)
        for label, marks in rows:
            if label.startswith("注："):
                continue
            result.append("| " + " | ".join([label, *marks]) + " |")
    table = "\n".join(result) + "\n"
    if args.output:
        with args.output.open("a" if args.append else "w") as output:
            output.write(table)
    else:
        print(table, end="")


if __name__ == "__main__":
    main()
