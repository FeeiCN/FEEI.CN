#!/usr/bin/env python3

from __future__ import annotations

import ast
import concurrent.futures
import json
import re
import subprocess
import time
import unicodedata
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from typing import Iterable
from urllib.parse import urlencode


ROOT = Path(__file__).resolve().parents[1]
PLAYLIST_PATH = ROOT / "src/components/GlobalMusicPlayer/playlist.ts"
MUSIC_DIR = ROOT / "static/music"
LYRICS_TS_PATH = ROOT / "src/components/GlobalMusicPlayer/localLyrics.ts"
REPORT_PATH = ROOT / "static/music/lyrics-report.json"
USER_AGENT = "Mozilla/5.0 (compatible; feei-site-lyrics-bot/1.0)"
TRACK_PATTERN = re.compile(
    r"localTrack\(\s*(?P<title>'(?:\\.|[^'])*')\s*,\s*(?P<artist>'(?:\\.|[^'])*')\s*,\s*(?P<file>'(?:\\.|[^'])*')\s*\)"
)


@dataclass(frozen=True)
class Track:
    title: str
    artist: str
    file_name: str

    @property
    def audio_path(self) -> Path:
        return MUSIC_DIR / self.file_name

    @property
    def lyric_file_name(self) -> str:
        p = Path(self.file_name)
        return str(p.with_suffix(".lrc"))

    @property
    def lyric_path(self) -> Path:
        return MUSIC_DIR / self.lyric_file_name


def parse_js_string(source: str) -> str:
    return ast.literal_eval(source)


def load_tracks() -> list[Track]:
    playlist_source = PLAYLIST_PATH.read_text()
    tracks: list[Track] = []

    for match in TRACK_PATTERN.finditer(playlist_source):
        track = Track(
            title=parse_js_string(match.group("title")),
            artist=parse_js_string(match.group("artist")),
            file_name=parse_js_string(match.group("file")),
        )
        if track.audio_path.exists():
            tracks.append(track)

    return tracks


def normalize(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", unescape(value or "")).lower()
    normalized = normalized.replace("&", " and ")
    normalized = re.sub(r"\([^)]*\)|（[^）]*）", "", normalized)
    normalized = re.sub(r"[^0-9a-z\u4e00-\u9fff\u3040-\u30ff]+", "", normalized)
    return normalized


def split_artists(artist: str) -> list[str]:
    normalized = artist.replace("＆", "&").replace("，", ",").replace("、", ",")
    parts = re.split(r"\s*&\s*|,|/| feat\.? | featuring | and ", normalized, flags=re.I)
    result = [part.strip() for part in parts if part.strip()]
    return result or [artist]


def fetch_json(url: str) -> list[dict]:
    result = subprocess.run(
        [
            "curl",
            "-sL",
            "--max-time",
            "15",
            "-H",
            f"User-Agent: {USER_AGENT}",
            "-H",
            "Accept: application/json",
            url,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = result.stdout
    data = json.loads(payload)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return [data]
    return []


def query_candidates(track: Track) -> list[dict]:
    queries: list[tuple[str, str | None]] = [(track.title, track.artist)]
    seen_queries = {(track.title, track.artist)}

    for artist in split_artists(track.artist):
        query = (track.title, artist)
        if query not in seen_queries:
            queries.append(query)
            seen_queries.add(query)

    title_without_parens = re.sub(r"\s*[\(（].*?[\)）]\s*", "", track.title).strip()
    if title_without_parens and title_without_parens != track.title:
        query = (title_without_parens, track.artist)
        if query not in seen_queries:
            queries.append(query)
            seen_queries.add(query)

    candidates: dict[int, dict] = {}

    for title, artist in queries:
        params = {"track_name": title}
        if artist:
            params["artist_name"] = artist
        url = f"https://lrclib.net/api/search?{urlencode(params)}"
        try:
            for candidate in fetch_json(url):
                candidate_id = candidate.get("id")
                if isinstance(candidate_id, int) and candidate_id not in candidates:
                    candidates[candidate_id] = candidate
        except subprocess.CalledProcessError:
            continue
        time.sleep(0.08)

    return list(candidates.values())


def score_candidate(track: Track, candidate: dict) -> int:
    query_title = normalize(track.title)
    query_artist = normalize(track.artist)
    query_artist_parts = [normalize(part) for part in split_artists(track.artist)]
    candidate_title = normalize(candidate.get("trackName") or candidate.get("name") or "")
    candidate_artist = normalize(candidate.get("artistName") or "")

    score = 0
    if candidate_title == query_title:
        score += 120
    elif query_title and (query_title in candidate_title or candidate_title in query_title):
        score += 70

    if candidate_artist == query_artist:
        score += 60

    for part in query_artist_parts:
        if not part:
            continue
        if candidate_artist == part:
            score += 55
            break
        if part in candidate_artist or candidate_artist in part:
            score += 30
            break

    if candidate.get("instrumental"):
        score -= 200

    if candidate.get("syncedLyrics"):
        score += 10
    elif candidate.get("plainLyrics"):
        score += 4

    return score


def pick_candidate(track: Track, candidates: Iterable[dict]) -> dict | None:
    scored = sorted(
        ((score_candidate(track, candidate), candidate) for candidate in candidates),
        key=lambda item: item[0],
        reverse=True,
    )
    if not scored:
        return None

    best_score, best_candidate = scored[0]
    if best_score < 100:
        return None
    return best_candidate


def seconds_to_lrc_timestamp(seconds: float) -> str:
    minutes = int(seconds // 60)
    remaining = seconds - minutes * 60
    return f"{minutes:02d}:{remaining:05.2f}"


def build_pseudo_lrc(plain_lyrics: str, duration: float | int | None) -> str | None:
    lines = [line.strip() for line in plain_lyrics.splitlines() if line.strip()]
    if not lines:
        return None

    total_duration = float(duration or 0)
    if total_duration <= 0:
        total_duration = max(len(lines) * 4, 4)

    interval = total_duration / max(len(lines), 1)
    lrc_lines = [
        f"[{seconds_to_lrc_timestamp(index * interval)}] {line}"
        for index, line in enumerate(lines)
    ]
    return "\n".join(lrc_lines) + "\n"


def write_lyrics_module(file_map: dict[str, str]) -> None:
    entries = "\n".join(
        f"  {json.dumps(audio_file, ensure_ascii=False)}: {json.dumps(lyric_file, ensure_ascii=False)},"
        for audio_file, lyric_file in sorted(file_map.items())
    )
    module_source = (
        "// Auto-generated by scripts/download_music_lyrics.py\n"
        "export const localLyricsFileByAudioFile: Record<string, string> = {\n"
        f"{entries}\n"
        "};\n"
    )
    LYRICS_TS_PATH.write_text(module_source)


def main() -> int:
    tracks = load_tracks()
    lyric_file_map: dict[str, str] = {}
    report: list[dict] = []

    def process_track(index_and_track: tuple[int, Track]) -> dict:
        index, track = index_and_track
        status = "missing"
        source = None
        lyric_content = None

        if track.lyric_path.exists() and track.lyric_path.stat().st_size > 0:
            return {
                "index": index,
                "file_name": track.file_name,
                "title": track.title,
                "artist": track.artist,
                "status": "existing",
                "source": "local",
                "matched_track": None,
                "matched_artist": None,
                "matched_id": None,
                "written": True,
            }

        if track.artist in {"BBC", "未知"} or track.file_name.startswith("bbc_"):
            return {
                "index": index,
                "file_name": track.file_name,
                "title": track.title,
                "artist": track.artist,
                "status": "skipped_non_vocal",
                "source": None,
                "matched_track": None,
                "matched_artist": None,
                "matched_id": None,
                "written": False,
            }

        try:
            candidate = pick_candidate(track, query_candidates(track))
        except Exception as error:  # noqa: BLE001
            return {
                "index": index,
                "file_name": track.file_name,
                "title": track.title,
                "artist": track.artist,
                "status": "error",
                "error": str(error),
                "written": False,
            }

        if candidate:
            if candidate.get("syncedLyrics"):
                lyric_content = candidate["syncedLyrics"].strip() + "\n"
                status = "synced"
                source = "syncedLyrics"
            elif candidate.get("plainLyrics"):
                lyric_content = build_pseudo_lrc(
                    candidate["plainLyrics"],
                    candidate.get("duration"),
                )
                if lyric_content:
                    status = "plain_to_lrc"
                    source = "plainLyrics"

        if lyric_content:
            track.lyric_path.write_text(lyric_content)
        return {
            "index": index,
            "file_name": track.file_name,
            "title": track.title,
            "artist": track.artist,
            "status": status,
            "source": source,
            "matched_track": candidate.get("trackName") if candidate else None,
            "matched_artist": candidate.get("artistName") if candidate else None,
            "matched_id": candidate.get("id") if candidate else None,
            "written": bool(lyric_content),
        }

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        futures = [
            executor.submit(process_track, (index, track))
            for index, track in enumerate(tracks, start=1)
        ]
        for future in concurrent.futures.as_completed(futures):
            item = future.result()
            if item.get("written"):
                lyric_file_map[item["file_name"]] = str(Path(item["file_name"]).with_suffix(".lrc"))
            report.append(item)
            error = item.get("error")
            if error:
                print(f"[{item['index']}/{len(tracks)}] error {item['file_name']}: {error}", flush=True)
            else:
                print(f"[{item['index']}/{len(tracks)}] {item['status']} {item['file_name']}", flush=True)

    report.sort(key=lambda item: item["index"])
    report_for_json = []
    for item in report:
        cleaned = dict(item)
        cleaned.pop("index", None)
        cleaned.pop("written", None)
        report_for_json.append(cleaned)

    write_lyrics_module(lyric_file_map)
    REPORT_PATH.write_text(json.dumps(report_for_json, ensure_ascii=False, indent=2) + "\n")

    summary: dict[str, int] = {}
    for item in report_for_json:
        summary[item["status"]] = summary.get(item["status"], 0) + 1

    print(json.dumps({"summary": summary, "written": len(lyric_file_map)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
