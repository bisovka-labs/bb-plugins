import unittest
from speechkit import assemble, transcribe, stt


class RecognitionTests(unittest.TestCase):
    def test_refinements_replace_finals_without_duplication(self):
        events = [
            stt.StreamingResponse(final=stt.AlternativeUpdate(alternatives=[stt.Alternative(text="первая фраза")])),
            stt.StreamingResponse(final_refinement=stt.FinalRefinement(final_index=0, normalized_text=stt.AlternativeUpdate(alternatives=[stt.Alternative(text="Первая фраза.")]))),
            stt.StreamingResponse(audio_cursors=stt.AudioCursors(final_index=1), final=stt.AlternativeUpdate(alternatives=[stt.Alternative(text="вторая фраза")])),
            stt.StreamingResponse(final_refinement=stt.FinalRefinement(final_index=1, normalized_text=stt.AlternativeUpdate(alternatives=[stt.Alternative(text="Вторая фраза.")]))),
        ]
        self.assertEqual(assemble(events), "Первая фраза. Вторая фраза.")

    def test_missing_key_fails_before_decode_or_network(self):
        with self.assertRaisesRegex(ValueError, "API key is missing"):
            transcribe(b"audio", "")

    def test_empty_upload_fails_before_network(self):
        with self.assertRaisesRegex(ValueError, "non-empty"):
            transcribe(b"", "dummy")


if __name__ == "__main__":
    unittest.main()
