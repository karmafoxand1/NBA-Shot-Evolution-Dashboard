import csv
import json
import tempfile
import unittest
from pathlib import Path

from scripts import preprocess


class PreprocessTests(unittest.TestCase):
    def test_parse_bool_accepts_dataset_values(self):
        self.assertTrue(preprocess.parse_bool("TRUE"))
        self.assertFalse(preprocess.parse_bool("FALSE"))
        self.assertTrue(preprocess.parse_bool(True))
        self.assertFalse(preprocess.parse_bool(False))

    def test_is_clutch_marks_late_fourth_quarter(self):
        self.assertTrue(preprocess.is_clutch({"QUARTER": "4", "MINS_LEFT": "4", "SECS_LEFT": "59"}))
        self.assertTrue(preprocess.is_clutch({"QUARTER": "5", "MINS_LEFT": "3", "SECS_LEFT": "10"}))
        self.assertFalse(preprocess.is_clutch({"QUARTER": "4", "MINS_LEFT": "5", "SECS_LEFT": "1"}))
        self.assertFalse(preprocess.is_clutch({"QUARTER": "3", "MINS_LEFT": "1", "SECS_LEFT": "0"}))

    def test_normalize_y_folds_full_court_to_frontcourt(self):
        self.assertAlmostEqual(preprocess.normalize_y(4.5), 4.5)
        self.assertAlmostEqual(preprocess.normalize_y(92.0), 2.0)
        self.assertAlmostEqual(preprocess.normalize_y(47.0), 47.0)

    def test_summarize_rows_computes_rates_and_top_players(self):
        rows = [
            {
                "SEASON_1": "2025",
                "TEAM_NAME": "Alpha",
                "PLAYER_NAME": "A One",
                "SHOT_MADE": "TRUE",
                "SHOT_TYPE": "3PT Field Goal",
                "BASIC_ZONE": "Above the Break 3",
                "ZONE_NAME": "Left Side Center",
                "SHOT_DISTANCE": "25",
                "LOC_X": "10",
                "LOC_Y": "24",
                "QUARTER": "4",
                "MINS_LEFT": "4",
                "SECS_LEFT": "30",
            },
            {
                "SEASON_1": "2025",
                "TEAM_NAME": "Alpha",
                "PLAYER_NAME": "A Two",
                "SHOT_MADE": "FALSE",
                "SHOT_TYPE": "2PT Field Goal",
                "BASIC_ZONE": "Mid-Range",
                "ZONE_NAME": "Center",
                "SHOT_DISTANCE": "14",
                "LOC_X": "0",
                "LOC_Y": "14",
                "QUARTER": "2",
                "MINS_LEFT": "6",
                "SECS_LEFT": "0",
            },
            {
                "SEASON_1": "2024",
                "TEAM_NAME": "Beta",
                "PLAYER_NAME": "B One",
                "SHOT_MADE": "TRUE",
                "SHOT_TYPE": "2PT Field Goal",
                "BASIC_ZONE": "Restricted Area",
                "ZONE_NAME": "Center",
                "SHOT_DISTANCE": "2",
                "LOC_X": "-1",
                "LOC_Y": "3",
                "QUARTER": "1",
                "MINS_LEFT": "9",
                "SECS_LEFT": "0",
            },
        ]

        result = preprocess.summarize_rows(rows, top_player_limit=10)

        season_2025 = next(item for item in result["season_summary"] if item["season"] == 2025)
        self.assertEqual(season_2025["attempts"], 2)
        self.assertAlmostEqual(season_2025["fg_pct"], 0.5)
        self.assertAlmostEqual(season_2025["three_rate"], 0.5)
        self.assertAlmostEqual(season_2025["avg_distance"], 19.5)
        self.assertEqual(season_2025["clutch_attempts"], 1)

        zone = next(item for item in result["zone_summary"] if item["season"] == 2025 and item["zone"] == "Above the Break 3")
        self.assertEqual(zone["attempts"], 1)
        self.assertEqual(zone["made"], 1)

        hex_cell = next(item for item in result["hex_summary"] if item["season"] == 2025 and item["team"] == "Alpha")
        self.assertIn("x", hex_cell)
        self.assertIn("y", hex_cell)
        self.assertIn("fg_pct", hex_cell)

    def test_write_outputs_creates_json_files(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir)
            data = {
                "season_summary": [{"season": 2025, "attempts": 2}],
                "zone_summary": [],
                "team_summary": [],
                "player_summary": [],
                "hex_summary": [],
                "metadata": {"total_attempts": 2},
            }
            preprocess.write_outputs(data, output)

            self.assertTrue((output / "season_summary.json").exists())
            with (output / "metadata.json").open(encoding="utf-8") as handle:
                metadata = json.load(handle)
            self.assertEqual(metadata["total_attempts"], 2)


if __name__ == "__main__":
    unittest.main()
