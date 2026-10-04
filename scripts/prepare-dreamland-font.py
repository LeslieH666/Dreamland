"""Build the local OFL rounded UI font from Resource Han Rounded CN v1.910.

Requires fontTools and Brotli. Supply the extracted ResourceHanRoundedCN-VF.otf;
the original archive URL, checksum and license are recorded beside the output.
"""
import argparse
import hashlib
import json
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
DESTINATION = ROOT / 'public/fonts/dreamland-rounded'


def build(source):
    if hashlib.sha256(Path(source).read_bytes()).hexdigest() != 'ee3f276c9f9ee77c726d4e9c88350a3de73fb297633c54d510971ee636dceb1e':
        raise ValueError('The source font does not match pinned Resource Han Rounded CN v1.910.')
    font = TTFont(source, recalcTimestamp=False)
    # Keep both upstream axes intact. Partial instancing of this release's
    # variable kerning tables is unsupported by some fontTools versions.
    # GB2312 covers common simplified Chinese; rare characters retain the
    # system fallback. Keep punctuation, Latin, kana and UI symbol blocks too.
    points = set(range(0x20, 0x100)) | set(range(0x2000, 0x3100))
    points |= set(range(0xFF00, 0xFFF0))
    for first in range(0xA1, 0xF8):
        for second in range(0xA1, 0xFF):
            try:
                points.update(map(ord, bytes([first, second]).decode('gb2312')))
            except UnicodeDecodeError:
                pass
    options = subset.Options()
    options.name_IDs = ['*']
    sub = subset.Subsetter(options=options)
    sub.populate(unicodes=points)
    sub.subset(font)
    # Modified OFL fonts use a distinct name, without the reserved name Source.
    for record in font['name'].names:
        if record.nameID in (1, 4, 6, 16):
            name = 'DreamLandUIRoundedCN' if record.nameID == 6 else 'DreamLand UI Rounded CN'
            record.string = name.encode(record.getEncoding())
    font.flavor = 'woff2'
    DESTINATION.mkdir(parents=True, exist_ok=True)
    output = DESTINATION / 'DreamLandUIRoundedCN.woff2'
    font.save(output)
    manifest = {
        'family': 'DreamLand UI Rounded CN', 'upstream': 'Resource Han Rounded CN',
        'version': '1.910', 'license': 'SIL Open Font License 1.1',
        'source': 'https://github.com/CyanoHao/Resource-Han-Rounded/releases/download/v1.910/RHR-CFF2-CN-1.910.7z',
        'archiveSha256': '4ad7b141535a1f11831287b0a6f71ddcec8daa92dc1d82c59892068f8ae5df09',
        'sourceSha256': hashlib.sha256(Path(source).read_bytes()).hexdigest(),
        'modifications': 'Original variable axes retained (rounded default 100); GB2312, Latin, punctuation, kana and UI symbols; renamed; WOFF2.',
        'file': output.name, 'bytes': output.stat().st_size,
        'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
    }
    (DESTINATION / 'source.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    print(f'Built local rounded font: {output.stat().st_size} bytes')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    build(parser.parse_args().source)
