#!/usr/bin/env python3
"""Delete videos attached in bb once they are older than N days (default 7).
Two copies exist per video: the project attachment bb serves to the chat
(<data dir>/attachments/<project>/) and the copy staged for the agent
(<data dir>/thread-storage/<thread>/Attachments/). Both go. Only files with a
video stream are touched: browsers label voice recordings video/webm too.
bb's database row stays, so the chat shows the attachment as unavailable.
N is the first line of video-cleanup.days next to this script.
Run by the dev.bisovka.bb-video-cleanup LaunchAgent; --dry-run lists only."""
import os, shutil, sqlite3, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.expanduser(os.environ.get('BB_DATA_DIR', '~/.bb'))
EXTS = ('.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.ogv', '.3gp')
DRY = '--dry-run' in sys.argv


def retention_days():
    try:
        return float(open(os.path.join(HERE, 'video-cleanup.days')).readline().strip())
    except (OSError, ValueError):
        return 7.0


FFPROBE = shutil.which('ffprobe') or next(
    (p for p in ('/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe') if os.path.exists(p)), None)


def has_video(path):
    if FFPROBE is None:  # without ffprobe, never guess on webm: it is usually audio
        return not path.lower().endswith(('.webm', '.ogv'))
    r = subprocess.run([FFPROBE, '-v', 'error', '-select_streams', 'v', '-show_entries',
                        'stream=codec_type', '-of', 'csv=p=0', path], capture_output=True, text=True)
    return r.returncode == 0 and 'video' in r.stdout


def remove(path, why):
    size = os.path.getsize(path)
    if not DRY:
        os.remove(path)
    print(f'{"would delete" if DRY else "deleted"} {path} ({size / 1048576:.1f} MB, {why})')
    return size


cutoff = time.time() - retention_days() * 86400
freed = 0

db = sqlite3.connect(f'file:{os.path.join(DATA, "bb.db")}?mode=ro', uri=True, timeout=30)
rows = db.execute("select project_id, stored_path from project_attachments "
                  "where mime_type like 'video/%' and ready_at is not null "
                  "and deletion_claimed_at is null and created_at < ?", (int(cutoff * 1000),)).fetchall()
db.close()
for project_id, stored_path in rows:
    root = os.path.realpath(os.path.join(DATA, 'attachments', project_id))
    path = os.path.realpath(os.path.join(root, stored_path))
    if path.startswith(root + os.sep) and os.path.isfile(path) and has_video(path):
        freed += remove(path, 'attachment')

storage = os.path.join(DATA, 'thread-storage')
for thread in os.listdir(storage) if os.path.isdir(storage) else []:
    staged = os.path.join(storage, thread, 'Attachments')
    if not os.path.isdir(staged):
        continue
    for name in os.listdir(staged):
        path = os.path.join(staged, name)
        if (name.lower().endswith(EXTS) and os.path.isfile(path) and not os.path.islink(path)
                and os.path.getmtime(path) < cutoff and has_video(path)):
            freed += remove(path, 'agent copy')

if freed:
    print(f'{time.strftime("%Y-%m-%d %H:%M")} freed {freed / 1048576:.1f} MB')
