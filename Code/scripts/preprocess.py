import argparse
import csv
import glob
import json
import re
from collections import Counter, defaultdict
from pathlib import Path


ZONE_ORDER = [
    "Restricted Area",
    "In The Paint (Non-RA)",
    "Mid-Range",
    "Left Corner 3",
    "Right Corner 3",
    "Above the Break 3",
    "Backcourt",
]


def slugify(value):
    slug = re.sub(r"[^A-Za-z0-9]+", "-", value).strip("-")
    return slug or "unknown"


def parse_bool(value):
    if isinstance(value, bool):
        return value
    return str(value).strip().upper() == "TRUE"


def safe_int(value, default=0):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def safe_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def normalize_y(value):
    y = safe_float(value)
    if y > 47:
        return 94 - y
    return y


def is_clutch(row):
    quarter = safe_int(row.get("QUARTER"))
    seconds_left = safe_int(row.get("MINS_LEFT")) * 60 + safe_int(row.get("SECS_LEFT"))
    return quarter >= 4 and seconds_left <= 5 * 60


def new_stats():
    return {
        "attempts": 0,
        "made": 0,
        "three_attempts": 0,
        "distance_sum": 0.0,
        "clutch_attempts": 0,
        "clutch_made": 0,
    }


def add_shot(stats, made, is_three, distance, clutch):
    stats["attempts"] += 1
    stats["made"] += 1 if made else 0
    stats["three_attempts"] += 1 if is_three else 0
    stats["distance_sum"] += distance
    stats["clutch_attempts"] += 1 if clutch else 0
    stats["clutch_made"] += 1 if clutch and made else 0


def finalize_stats(stats):
    attempts = stats["attempts"]
    clutch_attempts = stats["clutch_attempts"]
    return {
        "attempts": attempts,
        "made": stats["made"],
        "fg_pct": round(stats["made"] / attempts, 4) if attempts else 0,
        "three_rate": round(stats["three_attempts"] / attempts, 4) if attempts else 0,
        "avg_distance": round(stats["distance_sum"] / attempts, 2) if attempts else 0,
        "clutch_attempts": clutch_attempts,
        "clutch_fg_pct": round(stats["clutch_made"] / clutch_attempts, 4) if clutch_attempts else 0,
    }


def bin_center(value, size):
    return round(round(safe_float(value) / size) * size, 2)


def summarize_rows(rows, top_player_limit=450, bin_size=2.0):
    season_stats = defaultdict(new_stats)
    zone_stats = defaultdict(new_stats)
    team_stats = defaultdict(new_stats)
    player_stats = defaultdict(new_stats)
    hex_stats = defaultdict(new_stats)
    hex_zone_counts = defaultdict(Counter)
    action_counter = Counter()
    team_counter = Counter()
    player_counter = Counter()
    season_counter = Counter()
    total_attempts = 0

    for row in rows:
        if not row.get("SEASON_1"):
            continue

        season = safe_int(row.get("SEASON_1"))
        team = row.get("TEAM_NAME", "Unknown")
        player = row.get("PLAYER_NAME", "Unknown")
        zone = row.get("BASIC_ZONE", "Unknown")
        shot_type = row.get("SHOT_TYPE", "Unknown")
        action = row.get("ACTION_TYPE", "Unknown")
        zone_name = row.get("ZONE_NAME", "Unknown")
        made = parse_bool(row.get("SHOT_MADE"))
        is_three = shot_type.startswith("3PT")
        distance = safe_float(row.get("SHOT_DISTANCE"))
        clutch = is_clutch(row)
        x = safe_float(row.get("LOC_X"))
        y = normalize_y(row.get("LOC_Y"))
        bx = bin_center(x, bin_size)
        by = bin_center(y, bin_size)

        total_attempts += 1
        action_counter[action] += 1
        team_counter[team] += 1
        player_counter[player] += 1
        season_counter[season] += 1

        add_shot(season_stats[season], made, is_three, distance, clutch)
        add_shot(zone_stats[(season, zone, shot_type)], made, is_three, distance, clutch)
        add_shot(team_stats[(season, team)], made, is_three, distance, clutch)
        add_shot(player_stats[(season, player, team)], made, is_three, distance, clutch)
        all_hex_key = (season, "ALL", bx, by)
        team_hex_key = (season, team, bx, by)
        add_shot(hex_stats[all_hex_key], made, is_three, distance, clutch)
        add_shot(hex_stats[team_hex_key], made, is_three, distance, clutch)
        hex_zone_counts[all_hex_key][(zone, zone_name)] += 1
        hex_zone_counts[team_hex_key][(zone, zone_name)] += 1

    top_players = {name for name, _ in player_counter.most_common(top_player_limit)}

    season_summary = []
    for season, stats in sorted(season_stats.items()):
        item = {"season": season, **finalize_stats(stats)}
        item["season_label"] = f"{season - 1}-{str(season)[-2:]}"
        season_summary.append(item)

    zone_summary = []
    for (season, zone, shot_type), stats in sorted(zone_stats.items()):
        zone_summary.append(
            {
                "season": season,
                "zone": zone,
                "shot_type": shot_type,
                "zone_order": ZONE_ORDER.index(zone) if zone in ZONE_ORDER else len(ZONE_ORDER),
                **finalize_stats(stats),
            }
        )

    team_summary = []
    for (season, team), stats in sorted(team_stats.items()):
        team_summary.append({"season": season, "team": team, **finalize_stats(stats)})

    player_summary = []
    for (season, player, team), stats in sorted(player_stats.items()):
        if player in top_players or stats["attempts"] >= 250:
            player_summary.append({"season": season, "player": player, "team": team, **finalize_stats(stats)})

    hex_summary = []
    for (season, team, x, y), stats in sorted(hex_stats.items()):
        zone, zone_name = hex_zone_counts[(season, team, x, y)].most_common(1)[0][0]
        hex_summary.append(
            {
                "season": season,
                "team": team,
                "x": x,
                "y": y,
                "zone": zone,
                "zone_name": zone_name,
                **finalize_stats(stats),
            }
        )

    metadata = {
        "total_attempts": total_attempts,
        "season_count": len(season_counter),
        "team_count": len(team_counter),
        "player_count": len(player_counter),
        "top_actions": [{"action": name, "attempts": count} for name, count in action_counter.most_common(20)],
        "zones": ZONE_ORDER,
        "hex_files": {"ALL": "hex/ALL.json"},
    }

    return {
        "season_summary": season_summary,
        "zone_summary": zone_summary,
        "team_summary": team_summary,
        "player_summary": player_summary,
        "hex_summary": hex_summary,
        "metadata": metadata,
    }


def read_csv_files(dataset_dir):
    paths = sorted(glob.glob(str(Path(dataset_dir) / "NBA_*_Shots.csv")))
    for path in paths:
        with open(path, newline="", encoding="utf-8") as handle:
            yield from csv.DictReader(handle)


def write_outputs(data, output_dir):
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    hex_rows = data.get("hex_summary", [])
    if hex_rows:
        hex_dir = output / "hex"
        hex_dir.mkdir(parents=True, exist_ok=True)
        existing_hex = output / "hex_summary.json"
        if existing_hex.exists():
            existing_hex.unlink()
        team_files = {}
        for team, rows in sorted(defaultdict(list, group_rows(hex_rows, "team")).items()):
            file_name = f"{slugify(team)}.json" if team != "ALL" else "ALL.json"
            team_files[team] = f"hex/{file_name}"
            with (hex_dir / file_name).open("w", encoding="utf-8") as handle:
                json.dump(rows, handle, ensure_ascii=False, separators=(",", ":"))
        data["metadata"]["hex_files"] = team_files
    for name, value in data.items():
        if name == "hex_summary":
            continue
        with (output / f"{name}.json").open("w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))


def group_rows(rows, field):
    grouped = defaultdict(list)
    for row in rows:
        grouped[row[field]].append(row)
    return grouped


def main():
    parser = argparse.ArgumentParser(description="Preprocess NBA shot CSV files for the D3 visualization.")
    parser.add_argument(
        "--dataset",
        default=str(Path(__file__).resolve().parents[2] / "datasets" / "NBA_Shots_04_25-main"),
        help="Directory containing NBA_*_Shots.csv files.",
    )
    parser.add_argument(
        "--output",
        default=str(Path(__file__).resolve().parents[1] / "data"),
        help="Directory where JSON files will be written.",
    )
    parser.add_argument("--top-player-limit", type=int, default=450)
    parser.add_argument("--bin-size", type=float, default=2.0)
    args = parser.parse_args()

    rows = read_csv_files(args.dataset)
    data = summarize_rows(rows, top_player_limit=args.top_player_limit, bin_size=args.bin_size)
    write_outputs(data, args.output)
    print(
        f"Wrote {data['metadata']['total_attempts']:,} shots across "
        f"{data['metadata']['season_count']} seasons to {args.output}"
    )


if __name__ == "__main__":
    main()
