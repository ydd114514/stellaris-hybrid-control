"""Local research transcription of the user's public Stellaris tutorial.

No game/desktop access, account cookies, remote inference or publications.
"""
import argparse
import json
import pathlib
import time
from faster_whisper import WhisperModel, BatchedInferencePipeline

parser = argparse.ArgumentParser()
parser.add_argument('input')
parser.add_argument('--output', required=True)
parser.add_argument('--model', default='small')
parser.add_argument('--threads', type=int, default=8)
args = parser.parse_args()
started = time.monotonic()
model = WhisperModel(args.model, device='cpu', compute_type='int8', cpu_threads=args.threads,
                     download_root='C:/Users/YDD/AppData/Local/Cyberfish/models/whisper')
print(json.dumps({'stage': 'model-ready', 'seconds': round(time.monotonic()-started)}, ensure_ascii=False), flush=True)
engine = BatchedInferencePipeline(model=model)
segments, info = engine.transcribe(args.input, batch_size=8, language='zh', beam_size=3,
                                  vad_filter=True, initial_prompt='群星 Stellaris，科研船，工程船，恒星基地，前哨站，开采站，研究站，殖民，区划，合金，消费品，凝聚力，影响力。')
path = pathlib.Path(args.output)
path.parent.mkdir(parents=True, exist_ok=True)
count = 0
reported = -1
with path.open('w', encoding='utf-8') as output:
    for segment in segments:
        output.write(json.dumps({'start': segment.start, 'end': segment.end, 'text': segment.text.strip()}, ensure_ascii=False)+'\n')
        output.flush()
        count += 1
        minute = int(segment.end//60)
        if minute > reported:
            reported = minute
            print(json.dumps({'stage': 'transcribing', 'mediaMinute': minute, 'segments': count, 'elapsedSeconds': round(time.monotonic()-started)}), flush=True)
print(json.dumps({'complete': True, 'output': str(path), 'segments': count, 'duration': info.duration, 'elapsedSeconds': round(time.monotonic()-started)}), flush=True)
