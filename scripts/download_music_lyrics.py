#!/usr/bin/env python3

from __future__ import annotations

import argparse
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
JS_STRING = r'''(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")'''
TRACK_PATTERN = re.compile(
    rf"localTrack\(\s*(?P<title>{JS_STRING})\s*,\s*(?P<artist>{JS_STRING})\s*,\s*(?P<file>{JS_STRING})\s*\)"
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


def load_tracks(*, include_missing: bool = False) -> list[Track]:
    playlist_source = PLAYLIST_PATH.read_text()
    tracks: list[Track] = []

    for match in TRACK_PATTERN.finditer(playlist_source):
        track = Track(
            title=parse_js_string(match.group("title")),
            artist=parse_js_string(match.group("artist")),
            file_name=parse_js_string(match.group("file")),
        )
        if include_missing or track.audio_path.is_file():
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


def read_lyrics_module() -> dict[str, str]:
    if not LYRICS_TS_PATH.exists():
        return {}
    source = LYRICS_TS_PATH.read_text()
    match = re.search(r"export const localLyricsFileByAudioFile[^=]*=\s*({[\s\S]*});\s*$", source)
    if not match:
        raise ValueError("无法读取现有歌词映射，停止生成")
    mapping = ast.literal_eval(match.group(1))
    if not isinstance(mapping, dict) or any(
        not isinstance(key, str) or not isinstance(value, str)
        for key, value in mapping.items()
    ):
        raise ValueError("现有歌词映射格式错误，停止生成")
    return mapping


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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="下载同步歌词并增量更新歌词映射，保留仅在服务器存在的歌曲")
    parser.add_argument("--audio-file", action="append", help="只处理指定的已注册音频文件，可重复传入")
    args = parser.parse_args(argv)
    registered = {track.file_name: track for track in load_tracks(include_missing=True)}
    if args.audio_file:
        unavailable = [name for name in args.audio_file
                       if name not in registered or not registered[name].audio_path.is_file()]
        if unavailable:
            parser.error("指定歌曲未注册或本地音频缺失：" + ", ".join(unavailable))
        tracks = [registered[name] for name in dict.fromkeys(args.audio_file)]
    else:
        tracks = [track for track in registered.values() if track.audio_path.is_file()]
    previous = read_lyrics_module()
    lyric_file_map = previous.copy() if args.audio_file else {
        name: lyric for name, lyric in previous.items() if name in registered
    }
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
                track.audio_path.with_suffix(".lyrics.txt").write_text(candidate["plainLyrics"].strip() + "\n")
                status = "plain_only"
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
    if args.audio_file and REPORT_PATH.exists():
        old_report = json.loads(REPORT_PATH.read_text())
        selected = {track.file_name for track in tracks}
        report_for_json = [item for item in old_report if item.get("file_name") not in selected] + report_for_json
    REPORT_PATH.write_text(json.dumps(report_for_json, ensure_ascii=False, indent=2) + "\n")

    summary: dict[str, int] = {}
    for item in report:
        summary[item["status"]] = summary.get(item["status"], 0) + 1

    print(json.dumps({"summary": summary, "written": len(lyric_file_map)}, ensure_ascii=False))
    return int(any(item["status"] in {"missing", "error", "plain_only"} for item in report))


if __name__ == "__main__":
    raise SystemExit(main())
